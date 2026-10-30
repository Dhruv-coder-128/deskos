"""
DESK OS — PC Agent Pydantic Models
Strict schema validation for HTTP requests and WebSocket frames.
"""

from typing import Optional, Literal
from pydantic import BaseModel, Field


# -----------------------------------------------------------------------------
# REST API Models
# -----------------------------------------------------------------------------
class PairingRequest(BaseModel):
    pairing_code: str = Field(..., min_length=4, max_length=12, description="Ephemeral pairing PIN displayed on PC")
    client_id: str = Field(..., min_length=2, max_length=64, description="Unique client identifier")
    client_name: Optional[str] = Field("Android Client", max_length=64, description="Human readable device name")


class PairingResponse(BaseModel):
    status: Literal["paired"] = "paired"
    auth_token: str
    host_name: str
    device_id: str
    fingerprint: str
    server_time: float


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

