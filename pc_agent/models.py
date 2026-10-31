"""
DESK OS — PC Agent Pydantic Models
Strict schema validation for HTTP requests and WebSocket frames.
"""

from typing import Optional, Literal, List, Dict, Any
from pydantic import BaseModel, Field


# -----------------------------------------------------------------------------
# REST API Models
# -----------------------------------------------------------------------------
class PairingRequest(BaseModel):
    pairing_code: str = Field(..., min_length=4, max_length=12, description="Ephemeral pairing PIN displayed on PC")
    client_id: str = Field(..., min_length=2, max_length=64, description="Unique client identifier")
    client_name: Optional[str] = Field("Android Client", max_length=64, description="Human readable device name")
    client_nonce: Optional[str] = Field(None, max_length=64, description="Client random nonce for replay protection")
    connection_mode: Optional[str] = Field("auto", max_length=16, description="Connection mode: auto, local, remote")


class PairingResponse(BaseModel):
    status: Literal["paired"] = "paired"
    auth_token: str
    host_name: str
    device_id: str
    fingerprint: str
    server_time: float
    server_nonce: Optional[str] = None
    tailscale_ip: Optional[str] = None
    local_ip: Optional[str] = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    agent_version: str
    host_name: str
    paired_devices_count: int
    active_connections_count: int
    server_time: float


class RevokeRequest(BaseModel):
    client_id: Optional[str] = None


# -----------------------------------------------------------------------------
# WebSocket Message Models
# -----------------------------------------------------------------------------
class WSAuthMessage(BaseModel):
    type: Literal["auth"]
    token: str = Field(..., min_length=16, max_length=128)
    client_id: Optional[str] = Field(None, max_length=64)


class WSPingMessage(BaseModel):
    type: Literal["ping"]
    timestamp: float


class WSPongMessage(BaseModel):
    type: Literal["pong"]
    timestamp: float


class WSStatusQueryMessage(BaseModel):
    type: Literal["status_query"]


class WSErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str


# -----------------------------------------------------------------------------
# Telemetry Models (Phase 4)
# -----------------------------------------------------------------------------
class CPUMetrics(BaseModel):
    overall_percent: float
    per_core_percent: List[float]
    core_count_physical: Optional[int] = None
    core_count_logical: int
    frequency_mhz: Optional[float] = None
    temperature_c: Optional[float] = None  # null if unsupported/inaccessible


class GPUMetrics(BaseModel):
    available: bool
    name: Optional[str] = None
    utilization_percent: Optional[float] = None
    temperature_c: Optional[float] = None
    vram_used_bytes: Optional[int] = None
    vram_total_bytes: Optional[int] = None
    vram_percent: Optional[float] = None
    power_watts: Optional[float] = None


class RAMMetrics(BaseModel):
    total_bytes: int
    used_bytes: int
    available_bytes: int
    percent: float


class StorageDrive(BaseModel):
    drive: str
    mount: str
    total_bytes: int
    used_bytes: int
    free_bytes: int
    percent: float


class NetworkMetrics(BaseModel):
    download_speed_bps: float  # Bytes per second
    upload_speed_bps: float    # Bytes per second
    total_bytes_recv: int
    total_bytes_sent: int


class SystemMetrics(BaseModel):
    uptime_seconds: float
    host_name: str
    cpu_available: bool
    gpu_available: bool
    status: str


class TelemetryPayload(BaseModel):
    timestamp: float
    cpu: CPUMetrics
    gpu: GPUMetrics
    ram: RAMMetrics
    storage: List[StorageDrive]
    network: NetworkMetrics
    system: SystemMetrics


class WSTelemetryMessage(BaseModel):
    type: Literal["telemetry"] = "telemetry"
    data: TelemetryPayload


# -----------------------------------------------------------------------------
# Control Deck Models (Phase 5)
# -----------------------------------------------------------------------------
class AppInfo(BaseModel):
    id: str
    name: str
    available: bool
    icon: str


class AppsListResponse(BaseModel):
    type: Literal["apps_list"] = "apps_list"
    apps: List[AppInfo]


class ControlActionMessage(BaseModel):
    type: Literal["control_action"]
    action: str = Field(..., max_length=32, description="Target action identifier")
    app_id: Optional[str] = Field(None, max_length=64, description="Target application key")
    volume: Optional[int] = Field(None, ge=0, le=100, description="Volume level 0-100")
    muted: Optional[bool] = Field(None, description="Explicit mute flag")
    confirm: Optional[bool] = Field(None, description="Confirmation flag for critical actions")
    target_window_id: Optional[str] = Field(None, max_length=64, description="Target window identifier")
    target_hwnd: Optional[int] = Field(None, description="Target HWND for task switching")
    media_action: Optional[str] = Field(None, max_length=32, description="Media control action")
    search_query: Optional[str] = Field(None, max_length=64, description="Search query")


class ControlResultResponse(BaseModel):
    type: Literal["control_result"] = "control_result"
    action: str
    success: bool
    message: Optional[str] = None
    data: Optional[Dict[str, Any]] = None


class VolumeStateMessage(BaseModel):
    type: Literal["volume_state"] = "volume_state"
    volume: int
    muted: bool
    available: bool = True


class ScreenshotResponse(BaseModel):
    type: Literal["screenshot_result"] = "screenshot_result"
    success: bool
    image_data: Optional[str] = None  # Base64 data URL (e.g. data:image/jpeg;base64,...)
    timestamp: float
    error: Optional[str] = None


# -----------------------------------------------------------------------------
# Control Deck 2.1 Models (App Discovery, GSMTC Media, Task Switcher)
# -----------------------------------------------------------------------------
class DiscoveredApp(BaseModel):
    id: str
    name: str
    category: str = "general"
    available: bool = True
    icon_b64: Optional[str] = None
    icon_base64: Optional[str] = None
    icon_type: str = "default"


class DiscoveredAppsResponse(BaseModel):
    type: Literal["discovered_apps"] = "discovered_apps"
    apps: List[DiscoveredApp]
    total_count: int
    diagnostic: Optional[str] = None
    timestamp: float


class MediaState(BaseModel):
    type: Literal["media_state"] = "media_state"
    has_session: bool = False
    available: bool = False
    title: str = ""
    artist: str = ""
    album: str = ""
    playback_status: str = "Stopped"
    status: str = "STOPPED"
    position_seconds: float = 0.0
    duration_seconds: float = 0.0
    artwork_b64: Optional[str] = None
    artwork_base64: Optional[str] = None
    source_app: Optional[str] = None
    can_play_pause: bool = True
    can_next: bool = False
    can_prev: bool = False
    diagnostic: Optional[str] = None
    timestamp: float = 0.0


class RunningWindow(BaseModel):
    id: str
    hwnd: int
    title: str
    process_name: Optional[str] = None
    is_foreground: bool = False
    is_minimized: bool = False
    icon_b64: Optional[str] = None
    icon_base64: Optional[str] = None


class RunningWindowsResponse(BaseModel):
    type: Literal["running_windows"] = "running_windows"
    windows: List[RunningWindow]
    window_count: int
    open_count: int = 0
    foreground_hwnd: Optional[int] = None
    diagnostic: Optional[str] = None
    timestamp: float




