"""
DESK OS — Automated Controls Test Suite (Phase 5)
Verifies application launching, allowlist enforcement, volume reading & adjustment,
mute toggling, media key actions, screenshot compression, lock confirmation,
and rejection of unauthenticated/unallowlisted commands.
"""

import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from PIL import Image
from starlette.testclient import TestClient

# Ensure pc_agent is on sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from pc_agent.agent import app, device_store, pairing_manager
from pc_agent.controls import (
    AppLauncher,
    VolumeController,
    MediaController,
    ScreenshotCapturer,
    WorkstationController
)


class TestPCControls(unittest.TestCase):

    def setUp(self):
        device_store.revoke_all()
        pairing_manager.refresh_pin()
        pairing_manager.failed_attempts.clear()

    def tearDown(self):
        device_store.revoke_all()

    def test_allowlisted_apps_discovery(self):
        launcher = AppLauncher()
        apps = launcher.get_apps_list()
        self.assertGreater(len(apps), 0)
        app_ids = [a.id for a in apps]
        self.assertIn("chrome", app_ids)
        self.assertIn("edge", app_ids)
        self.assertIn("vscode", app_ids)
        self.assertIn("android_studio", app_ids)

    def test_reject_unallowlisted_app(self):
        launcher = AppLauncher()
        success, msg = launcher.launch("arbitrary_malicious_script.bat")
        self.assertFalse(success)
        self.assertIn("Unauthorized", msg)

        # Path traversal rejection
        success, msg = launcher.launch("../../windows/system32/cmd.exe")
        self.assertFalse(success)

    @patch("subprocess.Popen")
    def test_launch_allowlisted_app_mock(self, mock_popen):
        mock_popen.return_value = MagicMock()
        launcher = AppLauncher()
        # Find an app that has a path configured
        apps = launcher.get_apps_list()
        target_app = apps[0].id

        with patch.object(Path, "is_file", return_value=True):
            success, msg = launcher.launch(target_app)
            self.assertTrue(success)
            self.assertTrue(mock_popen.called)
            # Verify shell=False was strictly enforced
            _, kwargs = mock_popen.call_args
            self.assertFalse(kwargs.get("shell", True))

    def test_volume_reading_and_adjustment(self):
        vol_ctrl = VolumeController()
        st = vol_ctrl.get_state()
        self.assertIn("volume", st)
        self.assertIn("muted", st)
        self.assertIn("available", st)

        # Set volume
        new_vol = vol_ctrl.set_volume(50)
        self.assertEqual(new_vol["volume"], 50)

        # Set mute
        muted_st = vol_ctrl.set_mute(True)
        self.assertTrue(muted_st["muted"])
        unmuted_st = vol_ctrl.set_mute(False)
        self.assertFalse(unmuted_st["muted"])

    def test_media_controls(self):
        media = MediaController()
        # Test key dispatch execution
        self.assertTrue(media.play_pause())
        self.assertTrue(media.next_track())
        self.assertTrue(media.prev_track())

    def test_screenshot_compression(self):
        capturer = ScreenshotCapturer()
        # Create synthetic test image
        img = Image.new("RGB", (1920, 1080), color=(0, 255, 71))
        data_url = capturer._compress_to_jpeg_b64(img, max_width=1280, quality=70)
        self.assertTrue(data_url.startswith("data:image/jpeg;base64,"))
        self.assertGreater(len(data_url), 100)

    @patch("ctypes.windll.user32.LockWorkStation", return_value=1)
    def test_lock_workstation_with_mock(self, mock_lock):
        controller = WorkstationController()
        success, msg = controller.lock()
        self.assertTrue(success)
        self.assertTrue(mock_lock.called)

    def test_websocket_control_action_flow(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin

        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "ws_control_client",
            "client_name": "Control Tester"
        })
        token = pair_resp.json()["auth_token"]

        with client.websocket_connect("/ws/control") as ws:
            ws.send_json({"type": "auth", "token": token, "client_id": "ws_control_client"})
            self.assertEqual(ws.receive_json()["type"], "auth_success")

            # 1. Query Apps
            ws.send_json({"type": "get_apps"})
            apps_msg = ws.receive_json()
            self.assertEqual(apps_msg["type"], "apps_list")
            self.assertGreater(len(apps_msg["apps"]), 0)

            # 2. Query Volume
            ws.send_json({"type": "get_volume"})
            vol_msg = ws.receive_json()
            self.assertEqual(vol_msg["type"], "volume_state")
            self.assertIn("volume", vol_msg)

            # 3. Set Volume
            ws.send_json({"type": "control_action", "action": "set_volume", "volume": 65})
            vol_update = ws.receive_json()
            self.assertEqual(vol_update["type"], "volume_state")
            self.assertEqual(vol_update["volume"], 65)

            # 4. Media Key
            ws.send_json({"type": "control_action", "action": "media_play_pause"})
            media_resp = ws.receive_json()
            self.assertEqual(media_resp["type"], "control_result")
            self.assertEqual(media_resp["action"], "media_play_pause")
            self.assertTrue(media_resp["success"])

            # 5. Lock Workstation without confirm must fail
            ws.send_json({"type": "control_action", "action": "lock_workstation", "confirm": False})
            lock_resp = ws.receive_json()
            self.assertEqual(lock_resp["type"], "control_result")
            self.assertFalse(lock_resp["success"])
            self.assertIn("confirmation", lock_resp["message"].lower())

            # 6. Disallowed action must fail
            ws.send_json({"type": "control_action", "action": "format_c_drive"})
            err_resp = ws.receive_json()
            self.assertEqual(err_resp["type"], "error")

    def test_rest_control_endpoints(self):
        client = TestClient(app)

        # Unauthenticated request fails
        unauth_resp = client.get("/api/v1/control/apps")
        self.assertEqual(unauth_resp.status_code, 401)

        # Authenticate device
        active_pin = pairing_manager.active_pin
        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "rest_control_tester",
            "client_name": "REST Control Tester"
        })
        token = pair_resp.json()["auth_token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 1. GET /api/v1/control/apps
        apps_resp = client.get("/api/v1/control/apps", headers=headers)
        self.assertEqual(apps_resp.status_code, 200)
        self.assertGreater(len(apps_resp.json()["apps"]), 0)

        # 2. GET /api/v1/control/volume
        vol_resp = client.get("/api/v1/control/volume", headers=headers)
        self.assertEqual(vol_resp.status_code, 200)
        self.assertIn("volume", vol_resp.json())

        # 3. POST /api/v1/control/action (volume)
        act_resp = client.post("/api/v1/control/action", headers=headers, json={
            "type": "control_action",
            "action": "set_volume",
            "volume": 72
        })
        self.assertEqual(act_resp.status_code, 200)
        self.assertTrue(act_resp.json()["success"])

        # 4. Reject unallowlisted app
        bad_act = client.post("/api/v1/control/action", headers=headers, json={
            "type": "control_action",
            "action": "launch_app",
            "app_id": "cmd_injection_attempt"
        })
        self.assertEqual(bad_act.status_code, 200)
        self.assertFalse(bad_act.json()["success"])


if __name__ == "__main__":
    unittest.main()

