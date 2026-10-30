"""
DESK OS — PC Agent Configuration & Paired Device Store
Manages persistent device authorizations, active pairing PIN, and network bindings.
"""

import json
import time
import secrets
from pathlib import Path
from typing import Dict, Any, Optional

from pc_agent.crypto_utils import (
    generate_pairing_pin,
    hash_token
)

AGENT_VERSION = "1.0.0"
DEFAULT_PORT = 8765
DEFAULT_HOST = "0.0.0.0"

BASE_DIR = Path(__file__).resolve().parent
CERTS_DIR = BASE_DIR / "certs"
DATA_DIR = BASE_DIR / "data"

CERT_PATH = CERTS_DIR / "cert.pem"
KEY_PATH = CERTS_DIR / "key.pem"
PAIRED_DEVICES_PATH = DATA_DIR / "paired_devices.json"


class DeviceStore:
    """Manages persistent paired device authorizations in JSON."""

    def __init__(self, filepath: Path = PAIRED_DEVICES_PATH):
        self.filepath = Path(filepath)
        self.filepath.parent.mkdir(parents=True, exist_ok=True)
        self.devices: Dict[str, Dict[str, Any]] = self._load()

    def _load(self) -> Dict[str, Dict[str, Any]]:
        if not self.filepath.exists():
            return {}
        try:
            with open(self.filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save(self):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(self.devices, f, indent=2)
        except Exception as e:
            print(f"[STORE ERROR] Failed to save paired devices: {e}")

    def add_device(self, client_id: str, client_name: str, auth_token: str):
        self.devices[client_id] = {
            "client_id": client_id,
            "client_name": client_name,
            "token_hash": hash_token(auth_token),
            "paired_at": time.time(),
            "last_seen": time.time()
        }
        self._save()

    def verify_token(self, client_id: Optional[str], token: str) -> bool:
        input_hash = hash_token(token)
        if client_id and client_id in self.devices:
            dev = self.devices[client_id]
            if dev.get("token_hash") == input_hash:
                dev["last_seen"] = time.time()
                self._save()
                return True
            return False

        # If client_id is not specified, search across all paired devices
        for dev in self.devices.values():
            if dev.get("token_hash") == input_hash:
                dev["last_seen"] = time.time()
                self._save()
                return True
        return False

    def revoke_device(self, client_id: str) -> bool:
        if client_id in self.devices:
            del self.devices[client_id]
            self._save()
            return True
        return False

    def revoke_all(self):
        self.devices.clear()
        self._save()

    def get_count(self) -> int:
        return len(self.devices)


class PairingManager:
    """Manages the active pairing PIN, pairing window, and failed attempt rate limiting."""

    def __init__(self):
        self.active_pin: str = generate_pairing_pin()
        self.pin_created_at: float = time.time()
        self.pin_validity_seconds: int = 15 * 60  # 15 minutes validity
        self.failed_attempts: Dict[str, list] = {}  # ip -> list of timestamps

    def refresh_pin(self) -> str:
        self.active_pin = generate_pairing_pin()
        self.pin_created_at = time.time()
        return self.active_pin

    def is_rate_limited(self, client_ip: str) -> bool:
        now = time.time()
        window = 60.0  # 1 minute window
        attempts = self.failed_attempts.get(client_ip, [])
        # Keep attempts within the window
        attempts = [t for t in attempts if now - t < window]
        self.failed_attempts[client_ip] = attempts
        return len(attempts) >= 5

    def record_failed_attempt(self, client_ip: str):
        now = time.time()
        attempts = self.failed_attempts.get(client_ip, [])
        attempts.append(now)
        self.failed_attempts[client_ip] = attempts

    def verify_pin(self, pin: str, client_ip: str) -> bool:
        if self.is_rate_limited(client_ip):
            return False

        now = time.time()
        if now - self.pin_created_at > self.pin_validity_seconds:
            # Expired
            return False

        if secrets.compare_digest(pin.strip(), self.active_pin.strip()):
            # Successful: clear failed attempts
            self.failed_attempts.pop(client_ip, None)
            return True

        self.record_failed_attempt(client_ip)
        return False
