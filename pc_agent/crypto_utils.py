"""
DESK OS — PC Agent Cryptographic Utilities
Generates TLS certificates with Subject Alternative Names, calculates SHA-256 fingerprints,
and provides cryptographically secure token/PIN generation.
"""

import os
import socket
import secrets
import hashlib
import ipaddress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Tuple

from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization


def get_local_ip_addresses() -> List[str]:
    """Discover all local network IPv4 addresses for SAN inclusion."""
    ips = {"127.0.0.1"}
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass

    # Secondary UDP socket probe to find default egress route IP
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ips.add(s.getsockname()[0])
    except Exception:
        pass

    return sorted(list(ips))


def generate_self_signed_cert(
    cert_path: Path,
    key_path: Path,
    valid_days: int = 365
) -> Tuple[Path, Path, str]:
    """
    Generate an X.509 RSA-2048 self-signed certificate if one does not exist.
    Configures Subject Alternative Names (SANs) for localhost, 127.0.0.1, and all LAN IPs.
    Returns (cert_path, key_path, sha256_fingerprint).
    """
    cert_path = Path(cert_path)
    key_path = Path(key_path)

    cert_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    # Return existing certificate if already generated and valid
    if cert_path.exists() and key_path.exists():
        fingerprint = get_certificate_fingerprint(cert_path)
        return cert_path, key_path, fingerprint

    # Generate RSA 2048-bit Private Key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )

    hostname = socket.gethostname()
    local_ips = get_local_ip_addresses()

    # Subject & Issuer (Self-Signed)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "DESK OS Workstation"),
        x509.NameAttribute(NameOID.COMMON_NAME, hostname or "DESK-OS-HOST"),
    ])

    # SANs (DNS names and IP addresses)
    alt_names: List[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.DNSName(hostname) if hostname else x509.DNSName("desk-os-host")
    ]
    for ip_str in local_ips:
        try:
            alt_names.append(x509.IPAddress(ipaddress.ip_address(ip_str)))
        except ValueError:
            pass

    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=valid_days))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    # Write Private Key
    with open(key_path, "wb") as f:
        f.write(
            private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption()
            )
        )

    # Write Certificate
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    # Calculate Fingerprint
    fingerprint = get_certificate_fingerprint(cert_path)
    return cert_path, key_path, fingerprint


def get_certificate_fingerprint(cert_path: Path) -> str:
    """
    Calculate the SHA-256 fingerprint of the certificate in uppercase hex with colons:
    e.g., 7B:A2:3C:...
    """
    with open(cert_path, "rb") as f:
        cert_data = f.read()
    cert = x509.load_pem_x509_certificate(cert_data)
    digest = cert.fingerprint(hashes.SHA256())
    return ":".join(f"{b:02X}" for b in digest)


def generate_pairing_pin(length: int = 6) -> str:
    """Generate a cryptographically secure 6-digit numeric pairing PIN."""
    return "".join(str(secrets.randbelow(10)) for _ in range(length))


def generate_auth_token() -> str:
    """Generate a cryptographically secure 32-byte (64 hex characters) session token."""
    return secrets.token_hex(32)


def hash_token(token: str) -> str:
    """Compute SHA-256 hash of an authentication token for secure storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

