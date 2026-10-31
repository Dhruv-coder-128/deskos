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

from pc_agent.agent import app, device_store, pairing_manager, telemetry_collector
from pc_agent.crypto_utils import (
    generate_self_signed_cert,
    get_certificate_fingerprint
)
from pc_agent.config import CERT_PATH, KEY_PATH
from pc_agent.telemetry import TelemetryCollector


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

    def test_telemetry_collector_structure(self):
        collector = TelemetryCollector()
        payload = collector.collect()

        # CPU validation
        self.assertGreaterEqual(payload.cpu.overall_percent, 0.0)
        self.assertLessEqual(payload.cpu.overall_percent, 100.0)
        self.assertGreater(len(payload.cpu.per_core_percent), 0)
        self.assertGreaterEqual(payload.cpu.core_count_logical, 1)

        # GPU validation (RTX 3050 verified)
        self.assertTrue(payload.gpu.available)
        self.assertIn("RTX 3050", payload.gpu.name or "")
        self.assertGreater(payload.gpu.temperature_c or 0, 0)
        self.assertGreater(payload.gpu.vram_total_bytes or 0, 1024 * 1024)

        # RAM validation
        self.assertGreater(payload.ram.total_bytes, 1024 * 1024 * 1024)
        self.assertGreaterEqual(payload.ram.percent, 0.0)
        self.assertLessEqual(payload.ram.percent, 100.0)

        # Storage validation
        self.assertGreater(len(payload.storage), 0)
        self.assertTrue(any("C:" in d.drive for d in payload.storage))

        # Network validation
        self.assertGreaterEqual(payload.network.download_speed_bps, 0.0)
        self.assertGreaterEqual(payload.network.upload_speed_bps, 0.0)
        self.assertGreater(payload.network.total_bytes_recv, 0)

        # System validation
        self.assertGreater(payload.system.uptime_seconds, 0.0)
        self.assertEqual(payload.system.status, "active")

    def test_authenticated_telemetry_rest_endpoint(self):
        client = TestClient(app)
        # Unauthenticated request must fail
        unauth = client.get("/api/v1/telemetry")
        self.assertEqual(unauth.status_code, 401)

        # Pair device
        active_pin = pairing_manager.active_pin
        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "telemetry_rest_client",
            "client_name": "Telemetry REST Client"
        })
        token = pair_resp.json()["auth_token"]

        # Authenticated request
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.get("/api/v1/telemetry", headers=headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("cpu", data)
        self.assertIn("gpu", data)
        self.assertIn("ram", data)
        self.assertIn("storage", data)
        self.assertIn("network", data)
        self.assertIn("system", data)

    def test_websocket_telemetry_query_command(self):
        client = TestClient(app)
        active_pin = pairing_manager.active_pin
        pair_resp = client.post("/api/v1/pair", json={
            "pairing_code": active_pin,
            "client_id": "ws_telemetry_client",
            "client_name": "WS Telemetry Client"
        })
        token = pair_resp.json()["auth_token"]

        with client.websocket_connect("/ws/control") as ws:
            ws.send_json({"type": "auth", "token": token, "client_id": "ws_telemetry_client"})
            self.assertEqual(ws.receive_json()["type"], "auth_success")

            # Query telemetry
            ws.send_json({"type": "telemetry_query"})
            telem_msg = ws.receive_json()
            self.assertEqual(telem_msg["type"], "telemetry")
            self.assertIn("cpu", telem_msg["data"])
            self.assertIn("gpu", telem_msg["data"])
            self.assertIn("ram", telem_msg["data"])
            self.assertIn("storage", telem_msg["data"])
            self.assertIn("network", telem_msg["data"])
            self.assertIn("system", telem_msg["data"])

    def test_network_rate_calculation(self):
        collector = TelemetryCollector()
        n1 = collector._collect_network()
        time.sleep(0.05)
        n2 = collector._collect_network()
        self.assertGreaterEqual(n2.download_speed_bps, 0.0)
        self.assertGreaterEqual(n2.upload_speed_bps, 0.0)
        self.assertGreaterEqual(n2.total_bytes_recv, n1.total_bytes_recv)

    def test_cpu_temperature_unsupported_handling(self):
        collector = TelemetryCollector()
        # Verify call completes without exception and returns float or None
        temp = collector._get_cpu_temperature()
        self.assertTrue(temp is None or isinstance(temp, (int, float)))


if __name__ == "__main__":
    unittest.main()
