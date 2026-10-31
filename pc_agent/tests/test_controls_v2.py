"""
Unit tests for DESK OS Control Deck 2.0:
- Windows Application Discovery & Server Registry Launching
- GSMTC Media Session Queries & Playback Controls
- Windows Task Switcher (Window Enumeration, Minimized Restore, Foreground Focus)
"""

import sys
import unittest
from unittest.mock import patch, MagicMock
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parent
_AGENT_DIR = _TESTS_DIR.parent
_PROJECT_ROOT = _AGENT_DIR.parent
for p in [str(_PROJECT_ROOT), str(_AGENT_DIR)]:
    if p not in sys.path:
        sys.path.insert(0, p)

from pc_agent.controls import (
    AppDiscoveryEngine,
    MediaSessionController,
    TaskSwitcherController,
    extract_path_icon_base64
)
from pc_agent.models import DiscoveredApp, MediaState, RunningWindow


class TestControlDeckV2(unittest.TestCase):

    def setUp(self):
        self.app_discovery = AppDiscoveryEngine()
        self.media_session = MediaSessionController()
        self.task_switcher = TaskSwitcherController()

    def test_app_discovery_fallback_registry(self):
        """Test application discovery creates a valid sorted registry with safe IDs."""
        # Force fallback by mocking get_apps.ps1 not returning
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_proc.communicate.return_value = ("", "")
            mock_popen.return_value = mock_proc

            apps = self.app_discovery.discover_apps(force_refresh=True)
            self.assertIsInstance(apps, list)
            self.assertGreater(len(apps), 0)
            for a in apps:
                self.assertIsInstance(a, DiscoveredApp)
                self.assertTrue(a.id.startswith("app_"))
                self.assertTrue(len(a.name) > 0)
                self.assertIn(a.category, ["browser", "developer", "utility", "media", "system", "general"])

    def test_app_launch_security_validation(self):
        """Test that unauthorized application keys are strictly rejected."""
        # Seed registry with a known item
        self.app_discovery._registry = {
            "app_testcalc": {
                "id": "app_testcalc",
                "name": "Test Calculator",
                "app_id": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
                "category": "utility",
                "available": True
            }
        }

        # 1. Unregistered ID rejected
        success, msg = self.app_discovery.launch("app_unknown_injection_attempt")
        self.assertFalse(success)
        self.assertIn("Unauthorized or unapproved", msg)

        # 2. Registered ID launched with shell=False
        with patch("subprocess.Popen") as mock_popen:
            success, msg = self.app_discovery.launch("app_testcalc")
            self.assertTrue(success)
            self.assertIn("Launched Test Calculator", msg)
            mock_popen.assert_called_once()
            args, kwargs = mock_popen.call_args
            self.assertEqual(kwargs.get("shell"), False)
            self.assertEqual(args[0][0], "explorer.exe")

    def test_media_state_no_session(self):
        """Test media state query when no active media session exists."""
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_proc.communicate.return_value = ('{"has_session": false}', "")
            mock_popen.return_value = mock_proc

            state = self.media_session.get_media_state()
            self.assertIsInstance(state, MediaState)
            self.assertFalse(state.has_session)
            self.assertEqual(state.playback_status, "Stopped")

    def test_media_state_active_session(self):
        """Test media state query with active GSMTC track metadata."""
        sample_json = '''{
            "has_session": true,
            "title": "Cyberpunk 2077 Theme",
            "artist": "Marcin Przybyłowicz",
            "album": "Original Soundtrack",
            "playback_status": "Playing",
            "position_seconds": 45.2,
            "duration_seconds": 180.0,
            "source_app": "Spotify",
            "artwork_b64": "data:image/jpeg;base64,mockartwork"
        }'''
        with patch("subprocess.Popen") as mock_popen:
            mock_proc = MagicMock()
            mock_proc.communicate.return_value = (sample_json, "")
            mock_popen.return_value = mock_proc

            state = self.media_session.get_media_state()
            self.assertIsInstance(state, MediaState)
            self.assertTrue(state.has_session)
            self.assertEqual(state.title, "Cyberpunk 2077 Theme")
            self.assertEqual(state.artist, "Marcin Przybyłowicz")
            self.assertEqual(state.playback_status, "Playing")
            self.assertEqual(state.artwork_b64, "data:image/jpeg;base64,mockartwork")

    def test_media_action_dispatch(self):
        """Test media key dispatch for play_pause, next, previous and fallback."""
        # 1. Test action execution (GSMTC or fallback)
        ok, msg = self.media_session.execute_media_action("play_pause")
        self.assertTrue(ok)
        self.assertIn("play_pause", msg)

        # 2. Test virtual key fallback specifically when script path does not exist
        with patch("pathlib.Path.exists", return_value=False):
            with patch("ctypes.windll.user32.keybd_event") as mock_kb:
                ok, msg = self.media_session.execute_media_action("play_pause")
                self.assertTrue(ok)
                self.assertEqual(mock_kb.call_count, 2)

        # 3. Test invalid action rejection
        ok, msg = self.media_session.execute_media_action("invalid_action")
        self.assertFalse(ok)

    def test_task_switcher_window_enumeration(self):
        """Test running application window enumeration returns sorted list."""
        windows, count, fg = self.task_switcher.get_running_windows()
        self.assertIsInstance(windows, list)
        self.assertIsInstance(count, int)
        self.assertEqual(len(windows), count)
        for w in windows:
            self.assertIsInstance(w, RunningWindow)
            self.assertTrue(w.id.startswith("win_"))
            self.assertTrue(len(w.title) > 0)

    def test_task_switcher_focus_nonexistent_window(self):
        """Test focusing a dead window HWND reports failure."""
        with patch("ctypes.windll.user32.IsWindow", return_value=0):
            success, msg = self.task_switcher.focus_window(99999999)
            self.assertFalse(success)
            self.assertIn("no longer exists", msg)

    def test_task_switcher_focus_existing_window(self):
        """Test focusing an existing window brings to foreground."""
        target_hwnd = 12345
        with patch("ctypes.windll.user32.IsWindow", return_value=1), \
             patch("ctypes.windll.user32.IsIconic", return_value=1), \
             patch("ctypes.windll.user32.ShowWindow") as mock_show, \
             patch("ctypes.windll.user32.BringWindowToTop"), \
             patch("ctypes.windll.user32.SetForegroundWindow"), \
             patch("ctypes.windll.user32.GetForegroundWindow", return_value=target_hwnd):

            success, msg = self.task_switcher.focus_window(target_hwnd)
            self.assertTrue(success)
            self.assertIn("focused", msg.lower())
            mock_show.assert_called_with(target_hwnd, 9)  # SW_RESTORE


if __name__ == "__main__":
    unittest.main()

