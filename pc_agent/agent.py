"""
DESK OS — Windows PC Workstation Agent (Phase 3)
FastAPI + WebSocket + TLS Fingerprint Pinning + Secure Keystore-aligned Pairing.
"""

import sys
import time
import socket
import asyncio
import logging
import argparse
from pathlib import Path
from typing import Set, Dict, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from pc_agent.config import (
    AGENT_VERSION,
    DEFAULT_HOST,
    DEFAULT_PORT,
    CERT_PATH,
    KEY_PATH,
    DeviceStore,
    PairingManager
)
from pc_agent.crypto_utils import (
    generate_self_signed_cert,
    generate_auth_token,
    get_local_ip_addresses
)
from pc_agent.models import (
    PairingRequest,
    PairingResponse,
    HealthResponse,
    WSAuthMessage,
    WSPingMessage,
    WSPongMessage,
    WSStatusQueryMessage,
    WSErrorMessage
)

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [DESK OS] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("desk_os_agent")

app = FastAPI(
    title="DESK OS PC Agent",
    version=AGENT_VERSION,
    description="Workstation Host Agent for DESK OS Control Panel"
)

# Disallow arbitrary external browser origins (no loose CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://appassets.androidplatform.net", "http://localhost", "http://127.0.0.1"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

device_store = DeviceStore()
pairing_manager = PairingManager()
active_websockets: Set[WebSocket] = set()
app_start_time = time.time()
cert_fingerprint: str = ""


# -----------------------------------------------------------------------------
# REST Endpoints
# -----------------------------------------------------------------------------
@app.get("/", tags=["Info"])
async def root():
    return {
        "app": "DESK OS Workstation Agent",
        "version": AGENT_VERSION,
        "status": "RUNNING",
        "host": socket.gethostname(),
        "paired_clients": device_store.get_count()
    }


@app.get("/api/v1/health", response_model=HealthResponse, tags=["Diagnostics"])
async def health():
    return HealthResponse(
        status="ok",
        agent_version=AGENT_VERSION,
        host_name=socket.gethostname(),
        paired_devices_count=device_store.get_count(),
        active_connections_count=len(active_websockets),
        server_time=time.time()
    )


@app.post("/api/v1/pair", response_model=PairingResponse, tags=["Pairing"])
async def pair(request: Request, body: PairingRequest):
    client_ip = request.client.host if request.client else "unknown"

    if pairing_manager.is_rate_limited(client_ip):
        logger.warning(f"Rate limited pairing attempt from {client_ip}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed pairing attempts. Please wait 60 seconds."
        )

    if not pairing_manager.verify_pin(body.pairing_code, client_ip):
        logger.warning(f"Invalid pairing attempt from {client_ip} using code {body.pairing_code}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired pairing code."
        )

    # Issue cryptographically secure session token
    auth_token = generate_auth_token()
    device_store.add_device(
        client_id=body.client_id,
        client_name=body.client_name or "Android Node",
        auth_token=auth_token
    )

    logger.info(f"Successfully paired device '{body.client_name}' ({body.client_id}) from {client_ip}")

    # Refresh PIN for next pairing cycle
    pairing_manager.refresh_pin()

    return PairingResponse(
        status="paired",
        auth_token=auth_token,
        host_name=socket.gethostname(),
        device_id=body.client_id,
        fingerprint=cert_fingerprint,
        server_time=time.time()
    )


@app.post("/api/v1/revoke", tags=["Pairing"])
async def revoke(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header[7:].strip()
    revoked = False
    for dev_id, dev_data in list(device_store.devices.items()):
        from pc_agent.crypto_utils import hash_token
        if dev_data.get("token_hash") == hash_token(token):
            device_store.revoke_device(dev_id)
            revoked = True
            logger.info(f"Revoked paired credentials for device: {dev_id}")
            break

    if not revoked:
        raise HTTPException(status_code=404, detail="Token not found or already revoked")

    return {"status": "revoked"}


# -----------------------------------------------------------------------------
# WebSocket Control Endpoint
# -----------------------------------------------------------------------------
@app.websocket("/ws/control")
async def websocket_control(websocket: WebSocket):
    await websocket.accept()
    active_websockets.add(websocket)
    client_ip = websocket.client.host if websocket.client else "unknown"
    logger.info(f"[WS] New incoming connection from {client_ip}")

    authenticated = False
    authenticated_client_id: Optional[str] = None
    rate_limit_timestamps: list = []

    try:
        # Step 1: Enforce First-Message Authentication within 5.0 seconds
        try:
            auth_raw = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
            auth_msg = WSAuthMessage(**auth_raw)

            if device_store.verify_token(auth_msg.client_id, auth_msg.token):
                authenticated = True
                authenticated_client_id = auth_msg.client_id or "authenticated_client"
                logger.info(f"[WS AUTH] Successfully authenticated client: {authenticated_client_id}")

                await websocket.send_json({
                    "type": "auth_success",
                    "host_name": socket.gethostname(),
                    "server_time": time.time(),
                    "agent_version": AGENT_VERSION
                })
            else:
                logger.warning(f"[WS AUTH REJECT] Invalid credentials from {client_ip}")
                await websocket.send_json({
                    "type": "auth_error",
                    "message": "Invalid authentication credentials."
                })
                await websocket.close(code=4001)
                return
        except asyncio.TimeoutError:
            logger.warning(f"[WS AUTH TIMEOUT] No auth payload received within 5s from {client_ip}")
            await websocket.send_json({
                "type": "auth_error",
                "message": "Authentication timeout. Connection dropped."
            })
            await websocket.close(code=4001)
            return
        except (ValidationError, Exception) as e:
            logger.warning(f"[WS AUTH ERROR] Malformed auth payload from {client_ip}: {e}")
            await websocket.send_json({
                "type": "auth_error",
                "message": "Malformed authentication frame."
            })
            await websocket.close(code=4001)
            return

        # Step 2: Main Authenticated Loop with Heartbeat & Rate Limiting
        last_heartbeat_sent = time.time()
        last_pong_received = time.time()

        while True:
            # Poll with timeout to interleave heartbeat checks
            try:
                receive_task = asyncio.create_task(websocket.receive_json())
                done, _ = await asyncio.wait([receive_task], timeout=2.0)

                if done:
                    data = receive_task.result()
                    now = time.time()

                    # Connection Rate Limiting (max 20 messages per second)
                    rate_limit_timestamps = [t for t in rate_limit_timestamps if now - t < 1.0]
                    if len(rate_limit_timestamps) >= 20:
                        logger.warning(f"[WS RATE LIMIT] Client {authenticated_client_id} exceeded rate limit")
                        await websocket.send_json({
                            "type": "error",
                            "message": "Rate limit exceeded (max 20 msg/sec)."
                        })
                        continue
                    rate_limit_timestamps.append(now)

                    # Dispatch allowed frame types
                    msg_type = data.get("type")
                    if msg_type == "pong":
                        last_pong_received = now
                    elif msg_type == "ping":
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": data.get("timestamp", now)
                        })
                    elif msg_type == "status_query":
                        await websocket.send_json({
                            "type": "status_reply",
                            "host_name": socket.gethostname(),
                            "uptime": round(now - app_start_time, 1),
                            "connected_clients": len(active_websockets),
                            "server_time": now
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Unsupported or disallowed command: {msg_type}"
                        })
                else:
                    receive_task.cancel()

            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.debug(f"[WS MSG ERROR] {e}")

            # Heartbeat check: send ping every 15 seconds
            now = time.time()
            if now - last_heartbeat_sent >= 15.0:
                last_heartbeat_sent = now
                try:
                    await websocket.send_json({"type": "ping", "timestamp": now})
                except Exception:
                    break

            # Heartbeat timeout check: 35 seconds without pong
            if now - last_pong_received > 35.0:
                logger.warning(f"[WS TIMEOUT] Client {authenticated_client_id} heartbeat missing (>35s). Terminating.")
                await websocket.close(code=1001)
                break

    except WebSocketDisconnect:
        logger.info(f"[WS] Client {authenticated_client_id or client_ip} disconnected cleanly")
    except Exception as e:
        logger.error(f"[WS UNHANDLED] Exception on {client_ip}: {e}")
    finally:
        active_websockets.discard(websocket)


# -----------------------------------------------------------------------------
# Terminal Presentation & Runner
# -----------------------------------------------------------------------------
def print_cyberpunk_banner(host: str, port: int, ips: list, pin: str, fingerprint: str):
    banner = f"""
====================================================================
           DESK OS // WORKSTATION PC AGENT (PHASE 3)
====================================================================
  HOST NAME      : {socket.gethostname()}
  STATUS         : RUNNING [AUTHENTICATION ENFORCED]
  LISTEN PORT    : {port}
  LOCAL LAN IP(S): {', '.join(ips)}
  SECURE CHANNEL : WSS (TLS PINNED)
--------------------------------------------------------------------
  [!] ACTIVE PAIRING PIN      : {pin}
  [!] SHA-256 TLS FINGERPRINT : {fingerprint}
--------------------------------------------------------------------
  * Enter this IP, Port, Pairing PIN, and Fingerprint in your
    DESK OS phone panel to complete secure pairing.
  * Press CTRL+C to shutdown the workstation agent cleanly.
====================================================================
"""
    print(banner)


def main():
    global cert_fingerprint
    parser = argparse.ArgumentParser(description="DESK OS PC Agent")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host network interface to bind")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port to listen on (default: 8765)")
    parser.add_argument("--revoke-all", action="store_true", help="Revoke all paired devices and exit")
    parser.add_argument("--new-pin", action="store_true", help="Generate a new pairing PIN immediately")
    parser.add_argument("--no-tls", action="store_true", help="Disable TLS (loopback test mode only)")
    args = parser.parse_args()

    if args.revoke_all:
        device_store.revoke_all()
        print("[DESK OS] All paired credentials successfully revoked.")
        sys.exit(0)

    if args.new_pin:
        pin = pairing_manager.refresh_pin()
        print(f"[DESK OS] Generated new pairing PIN: {pin}")

    # Generate or load local TLS Certificate
    use_tls = not args.no_tls
    if use_tls:
        cert_p, key_p, fingerprint = generate_self_signed_cert(CERT_PATH, KEY_PATH)
        cert_fingerprint = fingerprint
    else:
        cert_p, key_p = None, None
        cert_fingerprint = "DISABLED (INSECURE TEST MODE)"

    local_ips = get_local_ip_addresses()
    print_cyberpunk_banner(
        host=args.host,
        port=args.port,
        ips=local_ips,
        pin=pairing_manager.active_pin,
        fingerprint=cert_fingerprint
    )

    import uvicorn
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        ssl_certfile=str(cert_p) if use_tls else None,
        ssl_keyfile=str(key_p) if use_tls else None,
        log_level="warning"
    )


if __name__ == "__main__":
    main()

