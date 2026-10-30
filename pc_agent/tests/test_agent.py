"""
DESK OS — PC Agent Automated Test Suite
Verifies API endpoints, pairing workflow, token validation, revocation,
WebSocket authentication, rate limiting, and TLS certificate generation.
Uses standard library unittest with Starlette TestClient.
"""

import sys
import time
import unittest
from pathlib import Path
from starlette.testclient import TestClient

# Ensure pc_agent is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from pc_agent.agent import app, device_store, pairing_manager
from pc_agent.crypto_utils import (
    generate_self_signed_cert,
    get_certificate_fingerprint
)
from pc_agent.config import CERT_PATH, KEY_PATH


class TestPCAgent(unittest.TestCase):

    def setUp(self):
        device_store.revoke_all()
        pairing_manager.refresh_pin()
        pairing_manager.failed_attempts.clear()

    def tearDown(self):
        device_store.revoke_all()

    def test_health_endpoint(self):
        client = TestClient(app)
        response = client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "ok")
        self.assertIn("host_name", data)
        self.assertEqual(data["paired_devices_count"], 0)

    def test_tls_certificate_fingerprint(self):
        cert_p, key_p, fp = generate_self_signed_cert(CERT_PATH, KEY_PATH)
        self.assertTrue(cert_p.exists())
        self.assertTrue(key_p.exists())
        self.assertEqual(len(fp.split(":")), 32)
        computed_fp = get_certificate_fingerprint(cert_p)
        self.assertEqual(fp, computed_fp)

    def test_pairing_success(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin

        payload = {
            "pairing_code": active_pin,
            "client_id": "test_phone_01",
            "client_name": "Galaxy M01s Test"
        }

        response = client.post("/api/v1/pair", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["status"], "paired")
        self.assertIn("auth_token", data)
        self.assertGreaterEqual(len(data["auth_token"]), 32)
        self.assertEqual(data["device_id"], "test_phone_01")

        # Verify device is recorded in store
        self.assertEqual(device_store.get_count(), 1)
        self.assertTrue(device_store.verify_token("test_phone_01", data["auth_token"]))

    def test_pairing_failure_invalid_code(self):
        client = TestClient(app)
        payload = {
            "pairing_code": "000000",
            "client_id": "test_phone_bad",
            "client_name": "Unauthorized Client"
        }

        if pairing_manager.active_pin == "000000":
            pairing_manager.active_pin = "999999"

        response = client.post("/api/v1/pair", json=payload)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Invalid or expired", response.json()["detail"])
        self.assertEqual(device_store.get_count(), 0)

    def test_pairing_rate_limiting(self):
        client = TestClient(app)
        payload = {
            "pairing_code": "999999",
            "client_id": "attacker",
            "client_name": "Brute Force Node"
        }

        # Send 5 failed attempts
        for _ in range(5):
            client.post("/api/v1/pair", json=payload)

        # 6th attempt must trigger HTTP 429
        resp = client.post("/api/v1/pair", json=payload)
        self.assertEqual(resp.status_code, 429)
        self.assertIn("Too many failed pairing attempts", resp.json()["detail"])

    def test_token_revocation(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin

        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "phone_to_revoke",
            "client_name": "Test Revocation"
        })
        token = pair_resp.json()["auth_token"]
        self.assertTrue(device_store.verify_token("phone_to_revoke", token))

        # Revoke with valid Bearer token
        revoke_resp = client.post(
            "/api/v1/revoke",
            headers={"Authorization": f"Bearer {token}"}
        )
        self.assertEqual(revoke_resp.status_code, 200)
        self.assertEqual(revoke_resp.json()["status"], "revoked")

        # Token must now be rejected
        self.assertFalse(device_store.verify_token("phone_to_revoke", token))
        self.assertEqual(device_store.get_count(), 0)

    def test_websocket_authentication_success(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin

        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "ws_client",
            "client_name": "WS Test Node"
        })
        token = pair_resp.json()["auth_token"]

        with client.websocket_connect("/ws/control") as ws:
            ws.send_json({
                "type": "auth",
                "token": token,
                "client_id": "ws_client"
            })
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "auth_success")
            self.assertIn("server_time", resp)

            # Test status query command
            ws.send_json({"type": "status_query"})
            status_resp = ws.receive_json()
            self.assertEqual(status_resp["type"], "status_reply")
            self.assertGreaterEqual(status_resp["connected_clients"], 1)

            # Test Ping/Pong
            ws.send_json({"type": "ping", "timestamp": time.time()})
            pong_resp = ws.receive_json()
            self.assertEqual(pong_resp["type"], "pong")

    def test_websocket_authentication_failure(self):
        client = TestClient(app)
        with client.websocket_connect("/ws/control") as ws:
            ws.send_json({
                "type": "auth",
                "token": "invalid_unregistered_token_12345",
                "client_id": "impostor"
            })
            resp = ws.receive_json()
            self.assertEqual(resp["type"], "auth_error")

    def test_websocket_malformed_message(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin

        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "ws_malformed_tester",
            "client_name": "Malformed Tester"
        })
        token = pair_resp.json()["auth_token"]

        with client.websocket_connect("/ws/control") as ws:
            ws.send_json({"type": "auth", "token": token, "client_id": "ws_malformed_tester"})
            self.assertEqual(ws.receive_json()["type"], "auth_success")

            # Send unknown command
            ws.send_json({"type": "disallowed_hack_attempt"})
            err_resp = ws.receive_json()
            self.assertEqual(err_resp["type"], "error")
            self.assertIn("Unsupported or disallowed", err_resp["message"])


if __name__ == "__main__":
    unittest.main()
