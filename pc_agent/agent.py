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
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Set, Dict, Any, Optional

# Ensure both project root and pc_agent directory are on sys.path
# so agent can be executed directly as `python agent.py` or as `python -m pc_agent.agent`
_AGENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _AGENT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

try:
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
        hash_token,
        get_local_ip_addresses,
        get_tailscale_ip,
        is_tailscale_ip
    )
    from pc_agent.models import (
        PairingRequest,
        PairingResponse,
        HealthResponse,
        WSAuthMessage,
        WSPingMessage,
        WSPongMessage,
        WSStatusQueryMessage,
        WSErrorMessage,
        TelemetryPayload,
        WSTelemetryMessage,
        AppInfo,
        AppsListResponse,
        ControlActionMessage,
        ControlResultResponse,
        VolumeStateMessage,
        ScreenshotResponse,
        DiscoveredApp,
        DiscoveredAppsResponse,
        MediaState,
        RunningWindow,
        RunningWindowsResponse
    )
    from pc_agent.telemetry import TelemetryCollector
    from pc_agent.controls import (
        AppLauncher,
        VolumeController,
        MediaController,
        ScreenshotCapturer,
        WorkstationController,
        AppDiscoveryEngine,
        MediaSessionController,
        TaskSwitcherController
    )
except ImportError:
    from config import (
        AGENT_VERSION,
        DEFAULT_HOST,
        DEFAULT_PORT,
        CERT_PATH,
        KEY_PATH,
        DeviceStore,
        PairingManager
    )
    from crypto_utils import (
        generate_self_signed_cert,
        generate_auth_token,
        hash_token,
        get_local_ip_addresses,
        get_tailscale_ip,
        is_tailscale_ip
    )
    from models import (
        PairingRequest,
        PairingResponse,
        HealthResponse,
        WSAuthMessage,
        WSPingMessage,
        WSPongMessage,
        WSStatusQueryMessage,
        WSErrorMessage,
        TelemetryPayload,
        WSTelemetryMessage,
        AppInfo,
        AppsListResponse,
        ControlActionMessage,
        ControlResultResponse,
        VolumeStateMessage,
        ScreenshotResponse,
        DiscoveredApp,
        DiscoveredAppsResponse,
        MediaState,
        RunningWindow,
        RunningWindowsResponse
    )
    from telemetry import TelemetryCollector
    from controls import (
        AppLauncher,
        VolumeController,
        MediaController,
        ScreenshotCapturer,
        WorkstationController,
        AppDiscoveryEngine,
        MediaSessionController,
        TaskSwitcherController
    )

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [DESK OS] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("desk_os_agent")

telemetry_collector = TelemetryCollector()
TELEMETRY_INTERVAL_SEC = 1.0

app_launcher = AppLauncher()
volume_controller = VolumeController()
media_controller = MediaController()
screenshot_capturer = ScreenshotCapturer()
workstation_controller = WorkstationController()

app_discovery = AppDiscoveryEngine()
media_session = MediaSessionController()
task_switcher = TaskSwitcherController()

device_store = DeviceStore()
pairing_manager = PairingManager()
active_websockets: Set[WebSocket] = set()
authenticated_websockets: Set[WebSocket] = set()
app_start_time = time.time()
cert_fingerprint: str = ""


async def telemetry_broadcaster_loop():
    """Background task streaming real-time workstation telemetry, media state & running tasks."""
    logger.info("[Telemetry] Live broadcaster active (1.0s interval).")
    loop_tick = 0
    while True:
        try:
            await asyncio.sleep(TELEMETRY_INTERVAL_SEC)
            loop_tick += 1
            if authenticated_websockets:
                dead: Set[WebSocket] = set()

                # 1. Telemetry every 1.0s
                payload = await asyncio.to_thread(telemetry_collector.collect)
                telem_msg = {
                    "type": "telemetry",
                    "data": payload.model_dump(mode="json")
                }
                for ws in list(authenticated_websockets):
                    try:
                        await ws.send_json(telem_msg)
                    except Exception:
                        dead.add(ws)

                # 2. Interleave GSMTC media state broadcast every 2.0s
                if loop_tick % 2 == 0:
                    try:
                        m_state = await asyncio.to_thread(media_session.get_media_state)
                        m_msg = m_state.model_dump()
                        for ws in list(authenticated_websockets):
                            try:
                                await ws.send_json(m_msg)
                            except Exception:
                                dead.add(ws)
                    except Exception as me:
                        logger.debug(f"Media broadcast exception: {me}")

                # 3. Interleave running windows broadcast every 3.0s
                if loop_tick % 3 == 0:
                    try:
                        wins, w_count, fg_hwnd = await asyncio.to_thread(task_switcher.get_running_windows)
                        w_msg = {
                            "type": "running_windows",
                            "windows": [w.model_dump() for w in wins],
                            "window_count": w_count,
                            "open_count": w_count,
                            "foreground_hwnd": fg_hwnd,
                            "timestamp": time.time()
                        }
                        for ws in list(authenticated_websockets):
                            try:
                                await ws.send_json(w_msg)
                            except Exception:
                                dead.add(ws)
                    except Exception as we:
                        logger.debug(f"Windows broadcast exception: {we}")

                for ws in dead:
                    authenticated_websockets.discard(ws)
                    active_websockets.discard(ws)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[Telemetry Broadcast Error] {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Launch live telemetry broadcast loop
    broadcaster_task = asyncio.create_task(telemetry_broadcaster_loop())
    yield
    # Shutdown: Cancel broadcaster loop cleanly
    broadcaster_task.cancel()
    try:
        await broadcaster_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="DESK OS PC Agent",
    version=AGENT_VERSION,
    description="Workstation Host Agent for DESK OS Control Panel",
    lifespan=lifespan
)

# Disallow arbitrary external browser origins (no loose CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://appassets.androidplatform.net", "http://localhost", "http://127.0.0.1"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


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

    # Discover network endpoints to provide client with optimal routing options
    all_ips = get_local_ip_addresses()
    lan_candidates = [ip for ip in all_ips if not ip.startswith("127.") and not is_tailscale_ip(ip)]
    primary_lan = lan_candidates[0] if lan_candidates else "127.0.0.1"
    tailscale_address = get_tailscale_ip()

    # Refresh PIN immediately for strict single-use OTP
    new_pin = pairing_manager.refresh_pin()
    logger.info(f"[Pairing] OTP consumed. Next single-use OTP generated: {new_pin}")

    return PairingResponse(
        status="paired",
        auth_token=auth_token,
        host_name=socket.gethostname(),
        device_id=body.client_id,
        fingerprint=cert_fingerprint,
        server_time=time.time(),
        local_ip=primary_lan,
        tailscale_ip=tailscale_address
    )


@app.post("/api/v1/revoke", tags=["Pairing"])
async def revoke(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header[7:].strip()
    revoked = False
    for dev_id, dev_data in list(device_store.devices.items()):
        if dev_data.get("token_hash") == hash_token(token):
            device_store.revoke_device(dev_id)
            revoked = True
            logger.info(f"Revoked paired credentials for device: {dev_id}")
            break

    if not revoked:
        raise HTTPException(status_code=404, detail="Token not found or already revoked")

    return {"status": "revoked"}


def _verify_auth_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = auth_header[7:].strip()
    is_valid = any(dev.get("token_hash") == hash_token(token) for dev in device_store.devices.values())
    if not is_valid:
        raise HTTPException(status_code=401, detail="Invalid authorization token")
    return token


@app.get("/api/v1/telemetry", response_model=TelemetryPayload, tags=["Telemetry"])
async def get_telemetry_snapshot(request: Request):
    """Authenticated endpoint returning an on-demand snapshot of workstation metrics."""
    _verify_auth_token(request)
    payload = await asyncio.to_thread(telemetry_collector.collect)
    return payload


@app.get("/api/v1/control/apps", response_model=AppsListResponse, tags=["Controls"])
async def get_allowlisted_apps(request: Request):
    """Authenticated endpoint returning configured allowlisted applications."""
    _verify_auth_token(request)
    return AppsListResponse(apps=app_launcher.get_apps_list())


@app.get("/api/v1/control/volume", response_model=VolumeStateMessage, tags=["Controls"])
async def get_master_volume(request: Request):
    """Authenticated endpoint returning current master volume and mute state."""
    _verify_auth_token(request)
    st = volume_controller.get_state()
    return VolumeStateMessage(**st)


@app.post("/api/v1/control/action", response_model=ControlResultResponse, tags=["Controls"])
async def execute_control_action_rest(cmd: ControlActionMessage, request: Request):
    """Authenticated REST action execution."""
    _verify_auth_token(request)
    action = cmd.action

    if action == "launch_app":
        if not cmd.app_id:
            raise HTTPException(status_code=400, detail="Missing app_id parameter")
        success, msg = app_launcher.launch(cmd.app_id)
        return ControlResultResponse(action=action, success=success, message=msg, data={"app_id": cmd.app_id})

    elif action == "set_volume":
        if cmd.volume is None:
            raise HTTPException(status_code=400, detail="Missing volume parameter")
        st = volume_controller.set_volume(cmd.volume)
        return ControlResultResponse(action=action, success=True, message=f"Volume set to {st['volume']}%", data=st)

    elif action == "set_mute":
        muted = bool(cmd.muted)
        st = volume_controller.set_mute(muted)
        return ControlResultResponse(action=action, success=True, message=f"Mute set to {muted}", data=st)

    elif action == "toggle_mute":
        st = volume_controller.toggle_mute()
        return ControlResultResponse(action=action, success=True, message=f"Mute toggled to {st['muted']}", data=st)

    elif action == "media_play_pause":
        ok = media_controller.play_pause()
        return ControlResultResponse(action=action, success=ok, message="Play/Pause dispatched")

    elif action == "media_next":
        ok = media_controller.next_track()
        return ControlResultResponse(action=action, success=ok, message="Next track dispatched")

    elif action == "media_prev":
        ok = media_controller.prev_track()
        return ControlResultResponse(action=action, success=ok, message="Previous track dispatched")

    elif action == "screenshot":
        success, b64_img, err = screenshot_capturer.capture()
        return ControlResultResponse(
            action=action,
            success=success,
            message="Screenshot captured" if success else (err or "Capture failed"),
            data={"image_data": b64_img, "timestamp": time.time()} if success else None
        )

    elif action == "lock_workstation":
        if not cmd.confirm:
            return ControlResultResponse(
                action=action,
                success=False,
                message="Lock workstation requires explicit confirmation."
            )
        success, msg = workstation_controller.lock()
        return ControlResultResponse(action=action, success=success, message=msg)

    elif action == "launch_discovered_app":
        if not cmd.app_id:
            raise HTTPException(status_code=400, detail="Missing app_id parameter")
        success, msg = await asyncio.to_thread(app_discovery.launch, cmd.app_id)
        return ControlResultResponse(action=action, success=success, message=msg, data={"app_id": cmd.app_id})

    elif action == "switch_window":
        target = cmd.target_hwnd
        if target is None and cmd.target_window_id:
            try:
                target = int(cmd.target_window_id.replace("win_", ""))
            except Exception:
                target = None
        if target is None:
            raise HTTPException(status_code=400, detail="Missing target_hwnd or target_window_id")
        success, msg = await asyncio.to_thread(task_switcher.focus_window, target)
        return ControlResultResponse(action=action, success=success, message=msg, data={"target_hwnd": target})

    elif action == "media_action":
        act = cmd.media_action or "play_pause"
        pos_sec = float(getattr(cmd, "position_seconds", 0.0) or 0.0)
        success, msg = await asyncio.to_thread(media_session.execute_media_action, act, pos_sec)
        return ControlResultResponse(action=action, success=success, message=msg)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported action: '{action}'")


@app.get("/api/v1/control/discovered_apps", response_model=DiscoveredAppsResponse, tags=["Controls"])
async def get_discovered_apps(request: Request):
    """Authenticated endpoint returning auto-discovered Windows applications."""
    _verify_auth_token(request)
    apps = await asyncio.to_thread(app_discovery.discover_apps, False)
    return DiscoveredAppsResponse(apps=apps, total_count=len(apps), timestamp=time.time())


@app.post("/api/v1/control/refresh_apps", response_model=DiscoveredAppsResponse, tags=["Controls"])
async def refresh_discovered_apps(request: Request):
    """Authenticated endpoint triggering a fresh discovery of Windows applications."""
    _verify_auth_token(request)
    apps = await asyncio.to_thread(app_discovery.discover_apps, True)
    return DiscoveredAppsResponse(apps=apps, total_count=len(apps), timestamp=time.time())


@app.get("/api/v1/control/media", response_model=MediaState, tags=["Controls"])
async def get_media_snapshot(request: Request):
    """Authenticated endpoint returning current GSMTC media session."""
    _verify_auth_token(request)
    return await asyncio.to_thread(media_session.get_media_state)


@app.get("/api/v1/control/windows", response_model=RunningWindowsResponse, tags=["Controls"])
async def get_running_windows(request: Request):
    """Authenticated endpoint returning open application windows."""
    _verify_auth_token(request)
    wins, count, fg = await asyncio.to_thread(task_switcher.get_running_windows)
    return RunningWindowsResponse(windows=wins, window_count=count, foreground_hwnd=fg, timestamp=time.time())



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
                authenticated_websockets.add(websocket)
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
                    elif msg_type == "telemetry_query":
                        telemetry_data = await asyncio.to_thread(telemetry_collector.collect)
                        await websocket.send_json({
                            "type": "telemetry",
                            "data": telemetry_data.model_dump(mode="json")
                        })
                    elif msg_type == "get_apps":
                        apps_payload = [a.model_dump() for a in app_launcher.get_apps_list()]
                        await websocket.send_json({"type": "apps_list", "apps": apps_payload})
                    elif msg_type == "get_discovered_apps":
                        force_ref = bool(data.get("refresh", False))
                        discovered = await asyncio.to_thread(app_discovery.discover_apps, force_ref)
                        await websocket.send_json({
                            "type": "discovered_apps",
                            "apps": [a.model_dump() for a in discovered],
                            "total_count": len(discovered),
                            "timestamp": time.time()
                        })
                    elif msg_type == "get_media_state":
                        m_state = await asyncio.to_thread(media_session.get_media_state)
                        await websocket.send_json(m_state.model_dump())
                    elif msg_type == "get_running_windows":
                        wins, count, fg = await asyncio.to_thread(task_switcher.get_running_windows)
                        await websocket.send_json({
                            "type": "running_windows",
                            "windows": [w.model_dump() for w in wins],
                            "window_count": count,
                            "open_count": count,
                            "foreground_hwnd": fg,
                            "timestamp": time.time()
                        })
                    elif msg_type == "get_volume":
                        v_st = volume_controller.get_state()
                        await websocket.send_json({"type": "volume_state", **v_st})
                    elif msg_type == "control_action":
                        action = data.get("action", "")
                        if action == "launch_app":
                            app_id = data.get("app_id", "")
                            success, msg = app_launcher.launch(app_id)
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "launch_app",
                                "success": success,
                                "message": msg,
                                "data": {"app_id": app_id}
                            })
                        elif action == "launch_discovered_app":
                            app_id = data.get("app_id", "")
                            success, msg = await asyncio.to_thread(app_discovery.launch, app_id)
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "launch_discovered_app",
                                "success": success,
                                "message": msg,
                                "data": {"app_id": app_id}
                            })
                        elif action == "switch_window":
                            target = data.get("target_hwnd")
                            if not target and data.get("target_window_id"):
                                try:
                                    target = int(str(data["target_window_id"]).replace("win_", ""))
                                except Exception:
                                    target = None
                            if target is not None:
                                success, msg = await asyncio.to_thread(task_switcher.focus_window, int(target))
                            else:
                                success, msg = False, "Missing target window identifier"
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "switch_window",
                                "success": success,
                                "message": msg,
                                "data": {"target_hwnd": target}
                            })
                        elif action == "media_action":
                            act = data.get("media_action") or "play_pause"
                            pos_sec = float(data.get("position_seconds", 0.0))
                            success, msg = await asyncio.to_thread(media_session.execute_media_action, act, pos_sec)
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "media_action",
                                "success": success,
                                "message": msg,
                                "data": {"media_action": act}
                            })
                            # Push fresh media state
                            m_st = await asyncio.to_thread(media_session.get_media_state)
                            await websocket.send_json(m_st.model_dump())
                        elif action == "set_volume":
                            vol = data.get("volume", 50)
                            v_st = volume_controller.set_volume(vol)
                            await websocket.send_json({"type": "volume_state", **v_st})
                        elif action == "set_mute":
                            muted = bool(data.get("muted", False))
                            v_st = volume_controller.set_mute(muted)
                            await websocket.send_json({"type": "volume_state", **v_st})
                        elif action == "toggle_mute":
                            v_st = volume_controller.toggle_mute()
                            await websocket.send_json({"type": "volume_state", **v_st})
                        elif action == "media_play_pause":
                            ok = media_controller.play_pause()
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "media_play_pause",
                                "success": ok,
                                "message": "Play/Pause media key sent"
                            })
                        elif action == "media_next":
                            ok = media_controller.next_track()
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "media_next",
                                "success": ok,
                                "message": "Next track media key sent"
                            })
                        elif action == "media_prev":
                            ok = media_controller.prev_track()
                            await websocket.send_json({
                                "type": "control_result",
                                "action": "media_prev",
                                "success": ok,
                                "message": "Previous track media key sent"
                            })
                        elif action == "screenshot":
                            success, img_b64, err = screenshot_capturer.capture()
                            await websocket.send_json({
                                "type": "screenshot_result",
                                "success": success,
                                "image_data": img_b64,
                                "timestamp": time.time(),
                                "error": err
                            })
                        elif action == "lock_workstation":
                            confirm = bool(data.get("confirm", False))
                            if not confirm:
                                await websocket.send_json({
                                    "type": "control_result",
                                    "action": "lock_workstation",
                                    "success": False,
                                    "message": "Workstation lock requires explicit client confirmation."
                                })
                            else:
                                success, msg = workstation_controller.lock()
                                await websocket.send_json({
                                    "type": "control_result",
                                    "action": "lock_workstation",
                                    "success": success,
                                    "message": msg
                                })
                        else:
                            await websocket.send_json({
                                "type": "error",
                                "message": f"Unsupported or disallowed action: '{action}'"
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
        authenticated_websockets.discard(websocket)
        active_websockets.discard(websocket)


# -----------------------------------------------------------------------------
# Terminal Presentation & Runner
# -----------------------------------------------------------------------------
def print_cyberpunk_banner(host: str, port: int, ips: list, pin: str, fingerprint: str):
    ts_ip = get_tailscale_ip()
    ts_display = f"{ts_ip}:{port} (Active)" if ts_ip else "Not detected - (Install Tailscale on PC & Phone for Remote Access)"
    lan_ips = [ip for ip in ips if not is_tailscale_ip(ip)]

    banner = f"""
====================================================================
           DESK OS // WORKSTATION PC AGENT (PHASE 6)
          [CONTROL DECK + REMOTE ACCESS (TAILSCALE READY)]
====================================================================
  HOST NAME          : {socket.gethostname()}
  STATUS             : RUNNING [AUTHENTICATED WSS / HTTPS]
  LISTEN PORT        : {port}
  LOCAL LAN IP(S)    : {', '.join(lan_ips)}
  TAILSCALE REMOTE   : {ts_display}
  TLS FINGERPRINT    : {fingerprint[:24]}... (Auto-pinned via PAKE)
--------------------------------------------------------------------
  [*] 6-DIGIT PAIRING OTP : [ {pin} ]
  [*] VALIDITY            : 5 MINUTES (SINGLE-USE & RATE-LIMITED)
--------------------------------------------------------------------
  * Enter the 6-Digit OTP in DESK OS phone panel.
  * No manual fingerprint typing needed! Trust is established via OTP.
  * Press CTRL+C to shutdown the workstation agent cleanly.
====================================================================
"""
    print(banner, flush=True)


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
    logger.info(f"[Pairing] Active 6-Digit OTP: [ {pairing_manager.active_pin} ] (Valid for 5 minutes)")

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

