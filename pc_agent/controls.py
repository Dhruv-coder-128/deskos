"""
DESK OS — Windows Workstation Controls Engine (Control Deck 2.0)
Handles:
- Dynamic Windows application discovery (Start Menu & UWP), caching & launching
- Global System Media Transport Controls (GSMTC) media tracking & playback
- Windows live task switcher (window enumeration, restore & focus)
- Core Audio master volume & mute management
- Mobile-optimized desktop screenshot capture
- Workstation security locking
Enforces shell=False, strict server registries, and zero arbitrary command execution.
"""

import os
import io
import sys
import time
import json
import base64
import ctypes
from ctypes import wintypes
import logging
import hashlib
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Set

_AGENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _AGENT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

try:
    from pc_agent.models import AppInfo, DiscoveredApp, MediaState, RunningWindow, NetworkDevice
except ImportError:
    from models import AppInfo, DiscoveredApp, MediaState, RunningWindow, NetworkDevice

logger = logging.getLogger("desk_os_controls")

DATA_DIR = _AGENT_DIR / "data"
SCRIPTS_DIR = _AGENT_DIR / "scripts"
ALLOWLIST_PATH = DATA_DIR / "app_allowlist.json"

# Virtual Key Codes & Win32 Constants
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
VK_MENU = 0x12
KEYEVENTF_KEYUP = 0x0002
MAXIMUM_ALLOWED = 0x02000000
SW_RESTORE = 9
SW_SHOW = 5
SRCCOPY = 0x00CC0020

# Win32 Icon, Window & Desktop API
user32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

user32.GetDC.restype = wintypes.HDC
user32.GetDC.argtypes = [wintypes.HWND]
user32.ReleaseDC.restype = ctypes.c_int
user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
user32.DestroyIcon.argtypes = [wintypes.HICON]
gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, wintypes.LPVOID, ctypes.c_void_p, wintypes.UINT]

user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.ShowWindowAsync.restype = wintypes.BOOL
user32.ShowWindowAsync.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.keybd_event.argtypes = [wintypes.BYTE, wintypes.BYTE, wintypes.DWORD, ctypes.c_size_t]
user32.keybd_event.restype = None

user32.OpenInputDesktop.restype = wintypes.HDESK
user32.OpenInputDesktop.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
user32.SetThreadDesktop.restype = wintypes.BOOL
user32.SetThreadDesktop.argtypes = [wintypes.HDESK]
user32.CloseDesktop.restype = wintypes.BOOL
user32.CloseDesktop.argtypes = [wintypes.HDESK]
user32.GetThreadDesktop.restype = wintypes.HDESK
user32.GetThreadDesktop.argtypes = [wintypes.DWORD]
user32.GetDesktopWindow.restype = wintypes.HWND
user32.GetSystemMetrics.restype = ctypes.c_int
user32.GetSystemMetrics.argtypes = [ctypes.c_int]

gdi32.CreateCompatibleDC.restype = wintypes.HDC
gdi32.CreateCompatibleDC.argtypes = [wintypes.HDC]
gdi32.CreateCompatibleBitmap.restype = wintypes.HBITMAP
gdi32.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
gdi32.SelectObject.restype = wintypes.HGDIOBJ
gdi32.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
gdi32.BitBlt.restype = wintypes.BOOL
gdi32.BitBlt.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.DWORD]
gdi32.DeleteDC.restype = wintypes.BOOL
gdi32.DeleteDC.argtypes = [wintypes.HDC]

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumDesktopWindows.argtypes = [wintypes.HANDLE, WNDENUMPROC, wintypes.LPARAM]


class ICONINFO(ctypes.Structure):
    _fields_ = [
        ("fIcon", wintypes.BOOL),
        ("xHotspot", wintypes.DWORD),
        ("yHotspot", wintypes.DWORD),
        ("hbmMask", wintypes.HBITMAP),
        ("hbmColor", wintypes.HBITMAP)
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD)
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", BITMAPINFOHEADER),
        ("bmiColors", wintypes.DWORD * 3)
    ]


class SHFILEINFO(ctypes.Structure):
    _fields_ = [
        ("hIcon", wintypes.HICON),
        ("iIcon", ctypes.c_int),
        ("dwAttributes", wintypes.DWORD),
        ("szDisplayName", wintypes.WCHAR * 260),
        ("szTypeName", wintypes.WCHAR * 80)
    ]


_ICON_CACHE: Dict[str, str] = {}


def hicon_to_base64_png(hIcon: wintypes.HICON) -> Optional[str]:
    """Convert a Win32 HICON to a Base64 data URL PNG using GDI and PIL."""
    if not hIcon:
        return None
    try:
        from PIL import Image
        icon_info = ICONINFO()
        if not user32.GetIconInfo(hIcon, ctypes.byref(icon_info)):
            return None

        hdc = user32.GetDC(0)
        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = 32
        bmi.bmiHeader.biHeight = -32  # Top-down bitmap
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0

        buf = (ctypes.c_ubyte * (32 * 32 * 4))()
        gdi32.GetDIBits(hdc, icon_info.hbmColor, 0, 32, ctypes.byref(buf), ctypes.byref(bmi), 0)

        im = Image.frombuffer("RGBA", (32, 32), bytes(buf), "raw", "BGRA", 0, 1)
        bio = io.BytesIO()
        im.save(bio, format="PNG")

        user32.ReleaseDC(0, hdc)
        if icon_info.hbmColor:
            gdi32.DeleteObject(icon_info.hbmColor)
        if icon_info.hbmMask:
            gdi32.DeleteObject(icon_info.hbmMask)

        return "data:image/png;base64," + base64.b64encode(bio.getvalue()).decode("ascii")
    except Exception as e:
        logger.debug(f"Failed to convert HICON to base64: {e}")
        return None


def extract_path_icon_base64(file_path: str) -> Optional[str]:
    """Extract file icon using SHGetFileInfoW and cache it."""
    if not file_path:
        return None
    if file_path in _ICON_CACHE:
        return _ICON_CACHE[file_path]

    try:
        shfi = SHFILEINFO()
        res = shell32.SHGetFileInfoW(str(file_path), 0, ctypes.byref(shfi), ctypes.sizeof(shfi), 0x100)
        if res and shfi.hIcon:
            b64 = hicon_to_base64_png(shfi.hIcon)
            user32.DestroyIcon(shfi.hIcon)
            if b64:
                _ICON_CACHE[file_path] = b64
                return b64
    except Exception as e:
        logger.debug(f"Icon extraction failed for {file_path}: {e}")

    return None


# =============================================================================
# PART 2: AUTOMATIC WINDOWS APPLICATION DISCOVERY & LAUNCHER
# =============================================================================
class AppDiscoveryEngine:
    """
    Discovers installed Windows applications (Start Menu shortcuts & UWP apps),
    maintains a strictly verified server-side registry, extracts icons, and executes apps securely.
    """

    def __init__(self):
        self._registry: Dict[str, Dict[str, Any]] = {}
        self._last_scan_time: float = 0.0

    def discover_apps(self, force_refresh: bool = False) -> List[DiscoveredApp]:
        """Enumerate installed applications via Start Menu programs and UWP apps."""
        if not force_refresh and self._registry:
            return self._build_response_list()

        new_registry: Dict[str, Dict[str, Any]] = {}
        seen_names: Set[str] = set()

        # Source 1: Direct fast scan of Start Menu Programs directories (All Users & Current User)
        start_menu_dirs = [
            os.path.join(os.environ.get("ProgramData", r"C:\ProgramData"), "Microsoft", "Windows", "Start Menu", "Programs"),
            os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs")
        ]

        for base_dir in start_menu_dirs:
            if not os.path.exists(base_dir):
                continue
            for root, _, files in os.walk(base_dir):
                for f in files:
                    if not f.lower().endswith(".lnk"):
                        continue
                    clean_name = f[:-4].strip()
                    lower_name = clean_name.lower()

                    # Filter uninstaller, help, readme, documentation
                    if any(bad in lower_name for bad in [
                        "uninstall", "uninstaller", "help", "readme", "documentation",
                        "release notes", "visit ", "website", "documentation", "manual"
                    ]):
                        continue

                    if lower_name in seen_names:
                        continue
                    seen_names.add(lower_name)

                    lnk_path = os.path.join(root, f)
                    category = self._categorize(clean_name)
                    slug = hashlib.md5(f"{clean_name}_{lnk_path}".encode("utf-8")).hexdigest()[:10]
                    clean_id = f"app_{slug}"

                    # Extract real native icon from the .lnk shortcut
                    icon_b64 = extract_path_icon_base64(lnk_path)

                    new_registry[clean_id] = {
                        "id": clean_id,
                        "name": clean_name,
                        "target": lnk_path,
                        "type": "lnk",
                        "category": category,
                        "icon_b64": icon_b64,
                        "available": True
                    }

        # Source 2: Microsoft Store / UWP Applications via Get-StartApps
        script_path = SCRIPTS_DIR / "get_apps.ps1"
        if script_path.exists():
            try:
                cmd = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script_path)]
                p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                stdout, _ = p.communicate(timeout=6)
                if stdout.strip():
                    uwp_apps = json.loads(stdout)
                    for item in uwp_apps:
                        name = item.get("name", "").strip()
                        raw_id = item.get("app_id", "").strip()
                        if not name or not raw_id:
                            continue
                        lower_name = name.lower()
                        if lower_name in seen_names:
                            continue
                        seen_names.add(lower_name)

                        category = item.get("category", self._categorize(name))
                        slug = hashlib.md5(f"{name}_{raw_id}".encode("utf-8")).hexdigest()[:10]
                        clean_id = f"app_{slug}"
                        icon_b64 = extract_path_icon_base64(raw_id) if os.path.exists(raw_id) else None

                        new_registry[clean_id] = {
                            "id": clean_id,
                            "name": name,
                            "target": raw_id,
                            "type": "uwp" if "!" in raw_id or not raw_id.endswith(".exe") else "exe",
                            "category": category,
                            "icon_b64": icon_b64,
                            "available": True
                        }
            except Exception as e:
                logger.debug(f"UWP Get-StartApps error: {e}")

        # Fallback candidates if discovery was empty
        if not new_registry:
            fallback = [
                {"name": "Google Chrome", "target": "Chrome", "category": "browser", "type": "uwp"},
                {"name": "Microsoft Edge", "target": "Microsoft.MicrosoftEdge_8wekyb3d8bbwe!App", "category": "browser", "type": "uwp"},
                {"name": "Visual Studio Code", "target": "Microsoft.VisualStudioCode", "category": "developer", "type": "uwp"},
                {"name": "Calculator", "target": "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "category": "utility", "type": "uwp"},
                {"name": "Windows Terminal", "target": "Microsoft.WindowsTerminal_8wekyb3d8bbwe!App", "category": "developer", "type": "uwp"}
            ]
            for item in fallback:
                clean_id = f"app_{hashlib.md5(item['name'].encode()).hexdigest()[:10]}"
                new_registry[clean_id] = {
                    "id": clean_id,
                    "name": item["name"],
                    "target": item["target"],
                    "type": item["type"],
                    "category": item["category"],
                    "icon_b64": None,
                    "available": True
                }

        self._registry = new_registry
        self._last_scan_time = time.time()
        logger.info(f"[CONTROL] Discovered and registered {len(self._registry)} Windows applications.")
        return self._build_response_list()

    def _categorize(self, name: str) -> str:
        nl = name.lower()
        if any(k in nl for k in ["chrome", "edge", "brave", "firefox", "opera", "vivaldi", "tor", "browser"]):
            return "browser"
        elif any(k in nl for k in ["code", "studio", "visual studio", "git", "python", "node", "terminal", "powershell", "cmd", "docker", "postman", "intellij", "pycharm", "antigravity"]):
            return "developer"
        elif any(k in nl for k in ["spotify", "vlc", "music", "player", "video", "sound", "netflix", "youtube", "camera", "voice", "audio"]):
            return "media"
        elif any(k in nl for k in ["calculator", "notepad", "clock", "snipping", "task manager", "7-zip", "winrar", "localsend", "paint", "alarm", "character map"]):
            return "utility"
        elif any(k in nl for k in ["control panel", "settings", "explorer", "system", "device manager", "disk cleanup", "file explorer"]):
            return "system"
        return "general"

    def _build_response_list(self) -> List[DiscoveredApp]:
        """Build sorted DiscoveredApp models from server registry."""
        items = []
        for app_id, entry in sorted(self._registry.items(), key=lambda x: x[1]["name"].lower()):
            b64 = entry.get("icon_b64")
            items.append(DiscoveredApp(
                id=entry["id"],
                name=entry["name"],
                category=entry.get("category", "general"),
                available=entry.get("available", True),
                icon_b64=b64,
                icon_base64=b64,
                icon_type="png" if b64 else "default"
            ))
        return items

    def launch(self, internal_app_id: str) -> Tuple[bool, str]:
        """
        Launch an application by its registered internal key.
        Guarantees no arbitrary command execution: strictly resolves from server registry.
        """
        if internal_app_id not in self._registry:
            for entry in self._registry.values():
                if entry["id"] == internal_app_id or entry["name"].lower() == internal_app_id.lower():
                    internal_app_id = entry["id"]
                    break
            else:
                return False, f"Unauthorized or unapproved application identifier: '{internal_app_id}'"

        entry = self._registry[internal_app_id]
        target = entry.get("target") or entry.get("app_id", "")
        name = entry["name"]
        app_type = entry.get("type", "lnk")

        try:
            # 1. ShellExecuteW for .lnk shortcuts
            if app_type == "lnk" and os.path.isfile(target):
                hinst = shell32.ShellExecuteW(None, "open", str(target), None, None, 1)
                if hinst > 32:
                    logger.info(f"[CONTROL] Launched shortcut '{name}' via ShellExecuteW")
                    return True, f"Launched {name}"
                # Fallback to explorer.exe
                subprocess.Popen(["explorer.exe", str(target)], shell=False)
                return True, f"Launched {name}"

            # 2. Universal shell:AppsFolder launcher for UWP
            if app_type == "uwp" or "!" in target or not target.endswith(".exe"):
                subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{target}"], shell=False)
                logger.info(f"[CONTROL] Dispatched shell:AppsFolder for '{name}' ({target})")
                return True, f"Launched {name}"

            # 3. Direct executable spawn
            if os.path.isfile(target):
                subprocess.Popen([str(target)], shell=False)
                logger.info(f"[CONTROL] Launched executable '{name}' ({target})")
                return True, f"Launched {name}"

            # Final fallback
            subprocess.Popen(["explorer.exe", f"shell:AppsFolder\\{target}"], shell=False)
            return True, f"Launched {name}"
        except Exception as e:
            logger.error(f"[CONTROL] Failed to launch application '{name}': {e}")
            return False, f"Launch failed: {e}"


# =============================================================================
# PART 3: ADVANCED MEDIA SESSION CONTROLLER (GSMTC)
# =============================================================================
class MediaSessionController:
    """Interacts with Windows Global System Media Transport Controls (GSMTC)."""

    def __init__(self):
        self._last_state: MediaState = MediaState(has_session=False, playback_status="Stopped")

    def get_media_state(self) -> MediaState:
        """Query live GSMTC session via get_media.ps1."""
        script_path = SCRIPTS_DIR / "get_media.ps1"
        if not script_path.exists():
            return self._last_state

        try:
            cmd = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script_path)]
            p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            stdout, _ = p.communicate(timeout=3)
            if stdout.strip():
                data = json.loads(stdout.strip())
                has_s = bool(data.get("has_session"))
                pb_status = data.get("playback_status", "Stopped")
                b64 = data.get("artwork_b64")

                state = MediaState(
                    has_session=has_s,
                    available=has_s,
                    title=data.get("title", ""),
                    artist=data.get("artist", ""),
                    album=data.get("album", ""),
                    playback_status=pb_status,
                    status=pb_status.upper(),
                    position_seconds=float(data.get("position_seconds", 0.0)),
                    duration_seconds=float(data.get("duration_seconds", 0.0)),
                    artwork_b64=b64,
                    artwork_base64=b64,
                    source_app=data.get("source_app", "Media"),
                    can_play_pause=bool(data.get("can_play_pause", True)),
                    can_next=bool(data.get("can_next", False)),
                    can_prev=bool(data.get("can_prev", False)),
                    diagnostic=data.get("diagnostic", ""),
                    timestamp=time.time()
                )
                self._last_state = state
                return state
        except Exception as e:
            logger.debug(f"GSMTC read exception: {e}")

        return self._last_state

    def execute_media_action(self, action: str, position_sec: float = 0.0) -> Tuple[bool, str]:
        """
        Execute media playback actions directly via GSMTC and native Windows virtual keys.
        CRITICAL SAFETY: When pausing or stopping, NEVER emit a toggle key (VK_MEDIA_PLAY_PAUSE)
        that could inadvertently restart media playback.
        """
        clean_action = action.strip().lower()
        valid_actions = {"play", "pause", "play_pause", "next", "previous", "stop", "seek"}
        if clean_action not in valid_actions:
            return False, f"Unknown media action: {action}"

        # 1. Primary: Direct WinRT GSMTC session control (TryPauseAsync, TryPlayAsync, etc.)
        script_path = SCRIPTS_DIR / "control_media.ps1"
        gsmtc_success = False
        if script_path.exists():
            try:
                cmd = [
                    "powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                    "-File", str(script_path),
                    "-Action", clean_action,
                    "-PositionSeconds", str(position_sec)
                ]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
                if proc.stdout.strip():
                    data = json.loads(proc.stdout.strip())
                    if data.get("success"):
                        gsmtc_success = True
                        logger.info(f"[CONTROL] GSMTC executed media action '{clean_action}' on session: {data.get('session')}")
                        return True, f"Executed '{clean_action}' via GSMTC ({data.get('session')})"
            except Exception as e:
                logger.debug(f"GSMTC control script error: {e}")

        # 2. Secondary fallback via Win32 keybd_event only if GSMTC was unavailable
        # SAFETY: NEVER map 'pause' or 'stop' to VK_MEDIA_PLAY_PAUSE (toggle)
        vk_map = {
            "play_pause": VK_MEDIA_PLAY_PAUSE,
            "next": VK_MEDIA_NEXT_TRACK,
            "previous": VK_MEDIA_PREV_TRACK,
            "stop": VK_MEDIA_STOP
        }
        vk = vk_map.get(clean_action)
        if vk:
            try:
                user32.keybd_event(vk, 0, 0, 0)
                user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
                logger.info(f"[CONTROL] Dispatched media fallback '{clean_action}' via keybd_event (VK: 0x{vk:02X})")
                return True, f"Dispatched '{clean_action}' via Windows virtual key"
            except Exception as e:
                logger.debug(f"keybd_event fallback error: {e}")

        if gsmtc_success:
            return True, f"Dispatched media action '{clean_action}'"
        return False, f"Media action '{clean_action}' could not be applied (no compatible session)"


# =============================================================================
# PART 4: WINDOWS TASK SWITCHER CONTROLLER
# =============================================================================
KNOWN_APP_NAMES: Dict[str, str] = {
    "chrome.exe": "Google Chrome",
    "brave.exe": "Brave Browser",
    "msedge.exe": "Microsoft Edge",
    "firefox.exe": "Firefox",
    "code.exe": "VS Code",
    "studio64.exe": "Android Studio",
    "explorer.exe": "File Explorer",
    "whatsapp.root.exe": "WhatsApp",
    "whatsapp.exe": "WhatsApp",
    "spotify.exe": "Spotify",
    "discord.exe": "Discord",
    "slack.exe": "Slack",
    "teams.exe": "Microsoft Teams",
    "notepad.exe": "Notepad",
    "calc.exe": "Calculator",
    "calculatorapp.exe": "Calculator",
    "applicationframehost.exe": "Windows App",
    "cmd.exe": "Terminal",
    "powershell.exe": "PowerShell",
    "windowsterminal.exe": "Terminal",
    "wt.exe": "Terminal",
    "antigravity ide.exe": "Antigravity IDE",
    "taskmgr.exe": "Task Manager"
}


def compute_app_name_and_initials(proc_name: Optional[str], title: str) -> Tuple[str, str]:
    low_proc = (proc_name or "").lower().strip()
    if low_proc in KNOWN_APP_NAMES:
        name = KNOWN_APP_NAMES[low_proc]
    elif low_proc:
        base = low_proc.replace(".exe", "").replace(".root", "").replace("_", " ")
        name = base.title()
    else:
        name = title.split(" - ")[-1].strip() if " - " in title else (title[:16] if title else "App")

    words = [w for w in name.split() if w]
    if len(words) >= 2:
        initials = (words[0][0] + words[1][0]).upper()
    elif words and len(words[0]) >= 2:
        initials = words[0][:2].upper()
    elif words:
        initials = words[0][0].upper()
    else:
        initials = "AP"

    return name, initials


class TaskSwitcherController:
    """Enumerates visible top-level application windows and manages window focus."""

    def __init__(self):
        self._window_cache: Dict[int, Dict[str, Any]] = {}

    def get_running_windows(self) -> Tuple[List[RunningWindow], int, Optional[int]]:
        """
        Enumerate all visible, interactive application windows.
        Returns: (windows_list, total_count, foreground_hwnd)
        """
        fg_hwnd = user32.GetForegroundWindow()
        discovered_windows: List[RunningWindow] = []

        # Connect to interactive desktop
        h_desk = user32.OpenInputDesktop(0, False, 0x0100)

        def enum_cb(hwnd, lparam):
            try:
                # Window must be visible or iconic (minimized)
                if not user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
                    return True

                length = user32.GetWindowTextLengthW(hwnd)
                if length == 0:
                    return True

                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value.strip()
                if not title:
                    return True

                # Exclude tool windows
                ex_style = user32.GetWindowLongW(hwnd, -20)  # GWL_EXSTYLE
                if ex_style & 0x00000080:  # WS_EX_TOOLWINDOW
                    return True

                # Check owner window: only include owned windows if WS_EX_APPWINDOW
                owner = user32.GetWindow(hwnd, 4)  # GW_OWNER
                if owner and not (ex_style & 0x00040000):  # WS_EX_APPWINDOW
                    return True

                # Filter background system utilities
                if title in [
                    "Program Manager", "Settings", "Windows Input Experience",
                    "DWM Notification Window", "Windows Shell Experience Host",
                    "Battery Meter", "Network Connections"
                ]:
                    return True

                is_fg = (hwnd == fg_hwnd)
                is_min = bool(user32.IsIconic(hwnd))

                # Retrieve process name and icon
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                proc_name = None
                icon_b64 = None

                try:
                    import psutil
                    if pid.value:
                        proc = psutil.Process(pid.value)
                        proc_name = proc.name()
                        exe_path = proc.exe()
                        if exe_path and os.path.exists(exe_path):
                            icon_b64 = extract_path_icon_base64(exe_path)
                except Exception:
                    pass

                app_name, initials = compute_app_name_and_initials(proc_name, title)

                discovered_windows.append(RunningWindow(
                    id=f"win_{hwnd}",
                    hwnd=hwnd,
                    title=title,
                    process_name=proc_name,
                    app_name=app_name,
                    initials=initials,
                    is_foreground=is_fg,
                    is_minimized=is_min,
                    icon_b64=icon_b64,
                    icon_base64=icon_b64
                ))
            except Exception:
                pass
            return True

        cb_func = WNDENUMPROC(enum_cb)
        if h_desk:
            user32.EnumDesktopWindows(h_desk, cb_func, 0)
            user32.CloseDesktop(h_desk)
        else:
            user32.EnumWindows(cb_func, 0)

        # Sort with foreground window first, then active windows
        discovered_windows.sort(key=lambda w: (not w.is_foreground, w.is_minimized, w.title.lower()))

        return discovered_windows, len(discovered_windows), fg_hwnd

    def focus_window(self, target_hwnd: int) -> Tuple[bool, str]:
        """
        Brings the target window to the foreground.
        Restores minimized window, applies Windows foreground activation rules, and verifies result.
        """
        h_desk = None
        old_desk = None
        attached_fg = False
        attached_target = False
        cur_thread = kernel32.GetCurrentThreadId()

        try:
            # 1. Connect thread to interactive user desktop FIRST (required for IsWindow & focus across window stations)
            h_desk = user32.OpenInputDesktop(0, False, MAXIMUM_ALLOWED)
            if h_desk:
                old_desk = user32.GetThreadDesktop(cur_thread)
                user32.SetThreadDesktop(h_desk)

            if not user32.IsWindow(target_hwnd):
                return False, f"Window (HWND: {target_hwnd}) no longer exists."

            # 2. Restore if minimized using ShowWindowAsync with SW_RESTORE
            if user32.IsIconic(target_hwnd):
                if hasattr(user32, 'ShowWindowAsync'):
                    user32.ShowWindowAsync(target_hwnd, SW_RESTORE)
                user32.ShowWindow(target_hwnd, SW_RESTORE)
            else:
                if hasattr(user32, 'ShowWindowAsync'):
                    user32.ShowWindowAsync(target_hwnd, SW_SHOW)

            # 3. Release Windows foreground lock via simulated Alt key
            user32.keybd_event(VK_MENU, 0, 0, 0)
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)

            # 4. Attach thread inputs safely
            cur_fg = user32.GetForegroundWindow()
            target_thread = user32.GetWindowThreadProcessId(target_hwnd, None)
            fg_thread = user32.GetWindowThreadProcessId(cur_fg, None) if cur_fg else 0

            if fg_thread and fg_thread != cur_thread:
                attached_fg = bool(user32.AttachThreadInput(cur_thread, fg_thread, True))
            if target_thread and target_thread != cur_thread:
                attached_target = bool(user32.AttachThreadInput(cur_thread, target_thread, True))

            # 5. Direct activation sequence
            user32.BringWindowToTop(target_hwnd)
            user32.SetForegroundWindow(target_hwnd)
            if hasattr(user32, 'SwitchToThisWindow'):
                user32.SwitchToThisWindow(target_hwnd, True)

        except Exception as e:
            logger.warning(f"[CONTROL] Focus exception for HWND={target_hwnd}: {e}")
        finally:
            if attached_fg:
                try:
                    user32.AttachThreadInput(cur_thread, fg_thread, False)
                except Exception:
                    pass
            if attached_target:
                try:
                    user32.AttachThreadInput(cur_thread, target_thread, False)
                except Exception:
                    pass

        # 6. Verify result with polling over 200ms DWM composition window
        for _ in range(6):
            time.sleep(0.035)
            now_fg = user32.GetForegroundWindow()
            if now_fg == target_hwnd:
                logger.info(f"[CONTROL] Focused window HWND={target_hwnd} successfully.")
                if old_desk and h_desk:
                    try:
                        user32.SetThreadDesktop(old_desk)
                    except Exception:
                        pass
                if h_desk:
                    try:
                        user32.CloseDesktop(h_desk)
                    except Exception:
                        pass
                return True, "Window focused successfully."

        now_fg = user32.GetForegroundWindow()
        if old_desk and h_desk:
            try:
                user32.SetThreadDesktop(old_desk)
            except Exception:
                pass
        if h_desk:
            try:
                user32.CloseDesktop(h_desk)
            except Exception:
                pass

        if now_fg == target_hwnd:
            return True, "Window focused."

        logger.warning(f"[CONTROL] Focus requested for HWND={target_hwnd}, but active foreground is HWND={now_fg}")
        return False, f"Windows did not focus requested window (Active HWND: {now_fg})."


# =============================================================================
# LEGACY PHASE 5 CONTROLLERS (PRESERVED)
# =============================================================================
class AppLauncher:
    """Manages verified, allowlisted application launching with shell=False."""

    DEFAULT_CANDIDATES = {
        "chrome": {"name": "Google Chrome", "paths": [r"C:\Program Files\Google\Chrome\Application\chrome.exe"], "icon": "chrome"},
        "edge": {"name": "Microsoft Edge", "paths": [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"], "icon": "edge"},
        "vscode": {"name": "VS Code", "paths": [os.path.expandvars(r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe")], "icon": "code"},
        "studio": {"name": "Android Studio", "paths": [r"C:\Program Files\Android\Android Studio\bin\studio64.exe"], "icon": "android"},
        "brave": {"name": "Brave Browser", "paths": [r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"], "icon": "globe"},
        "terminal": {"name": "Windows Terminal", "paths": [os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe"), r"C:\Windows\System32\cmd.exe"], "icon": "terminal"},
        "calculator": {"name": "Calculator", "paths": [r"C:\Windows\System32\calc.exe"], "icon": "calculator"},
        "notepad": {"name": "Notepad", "paths": [r"C:\Windows\System32\notepad.exe"], "icon": "file-text"}
    }

    def __init__(self, config_path: Path = ALLOWLIST_PATH):
        self.config_path = Path(config_path)
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        self.allowlist: Dict[str, Dict[str, Any]] = self._load()

    def _load(self) -> Dict[str, Dict[str, Any]]:
        if self.config_path.exists():
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to read allowlist from {self.config_path}: {e}")

        bootstrapped: Dict[str, Dict[str, Any]] = {}
        for app_id, data in self.DEFAULT_CANDIDATES.items():
            matched_path = None
            for p in data["paths"]:
                if Path(p).is_file():
                    matched_path = str(p)
                    break
            bootstrapped[app_id] = {
                "name": data["name"],
                "executable": matched_path or data["paths"][0],
                "icon": data["icon"],
                "args": []
            }
        return bootstrapped

    def get_apps_list(self) -> List[AppInfo]:
        apps: List[AppInfo] = []
        for app_id, item in self.allowlist.items():
            exe_path = Path(item.get("executable", ""))
            apps.append(AppInfo(
                id=app_id,
                name=item.get("name", app_id),
                available=exe_path.is_file(),
                icon=item.get("icon", "grid")
            ))
        return apps

    def launch(self, app_id: str) -> Tuple[bool, str]:
        if app_id not in self.allowlist:
            return False, f"Unauthorized application key: '{app_id}'"
        item = self.allowlist[app_id]
        exe_path = Path(item.get("executable", ""))
        if not exe_path.is_file():
            return False, f"Application executable not found on host: {exe_path}"
        try:
            subprocess.Popen([str(exe_path)] + item.get("args", []), shell=False)
            logger.info(f"[CONTROL] Launched allowlisted app '{app_id}' ({exe_path})")
            return True, f"Launched {item.get('name', app_id)}"
        except Exception as e:
            return False, f"Failed to spawn process: {e}"


class VolumeController:
    """Manages Windows master volume and mute state via Core Audio API."""

    def _get_endpoint(self):
        try:
            from pycaw.pycaw import AudioUtilities
            speakers = AudioUtilities.GetSpeakers()
            if speakers:
                return speakers.EndpointVolume
        except Exception:
            pass
        return None

    def get_state(self) -> Dict[str, Any]:
        try:
            endpoint = self._get_endpoint()
            if endpoint:
                scalar = endpoint.GetMasterVolumeLevelScalar()
                muted = bool(endpoint.GetMute())
                return {"volume": round(scalar * 100), "muted": muted, "available": True}
        except Exception:
            pass
        return {"volume": 0, "muted": False, "available": False}

    def set_volume(self, level: int) -> Dict[str, Any]:
        clamped = max(0, min(100, int(level)))
        try:
            endpoint = self._get_endpoint()
            if endpoint:
                endpoint.SetMasterVolumeLevelScalar(clamped / 100.0, None)
                muted = bool(endpoint.GetMute())
                return {"volume": clamped, "muted": muted, "available": True}
        except Exception:
            pass
        return {"volume": clamped, "muted": False, "available": False}

    def set_mute(self, muted: bool) -> Dict[str, Any]:
        try:
            endpoint = self._get_endpoint()
            if endpoint:
                endpoint.SetMute(1 if muted else 0, None)
                scalar = endpoint.GetMasterVolumeLevelScalar()
                return {"volume": round(scalar * 100), "muted": muted, "available": True}
        except Exception:
            pass
        return {"volume": 0, "muted": muted, "available": False}

    def toggle_mute(self) -> Dict[str, Any]:
        current = self.get_state()
        return self.set_mute(not current["muted"])


class MediaController:
    """Sends native Windows media key events to active media players."""

    @staticmethod
    def _send_vk(vk_code: int) -> bool:
        try:
            user32.keybd_event(vk_code, 0, 0, 0)
            user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)
            return True
        except Exception:
            return False

    def play_pause(self) -> bool:
        return self._send_vk(VK_MEDIA_PLAY_PAUSE)

    def next_track(self) -> bool:
        return self._send_vk(VK_MEDIA_NEXT_TRACK)

    def prev_track(self) -> bool:
        return self._send_vk(VK_MEDIA_PREV_TRACK)


class ScreenshotCapturer:
    """Captures interactive desktop screenshots on-demand, compressed for mobile delivery."""

    @staticmethod
    def _compress_to_jpeg_b64(img, max_width: int = 1280, quality: int = 70) -> str:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        if img.width > max_width:
            scale = max_width / float(img.width)
            img = img.resize((max_width, max(1, int(img.height * scale))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        return f"data:image/jpeg;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"

    def capture(self) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Captures the interactive Windows desktop from the logged-in user session.
        Attaches thread to input desktop, captures via 64-bit GDI BitBlt + GetDIBits,
        and gracefully handles locked screens or non-interactive sessions.
        """
        h_desk = None
        old_desk = None
        cur_thread = kernel32.GetCurrentThreadId()

        try:
            # Connect thread to interactive user desktop
            h_desk = user32.OpenInputDesktop(0, False, MAXIMUM_ALLOWED)
            if not h_desk:
                return False, None, "Desktop window station inaccessible (screen locked or non-interactive service session)."

            old_desk = user32.GetThreadDesktop(cur_thread)
            if not user32.SetThreadDesktop(h_desk):
                return False, None, "Cannot attach to interactive desktop (workstation screen locked)."

            w = user32.GetSystemMetrics(0)
            h = user32.GetSystemMetrics(1)
            if w <= 0 or h <= 0:
                return False, None, "Invalid display dimensions."

            h_dc = user32.GetDC(None)
            if not h_dc:
                return False, None, "Could not acquire screen device context."

            h_mem = gdi32.CreateCompatibleDC(h_dc)
            h_bmp = gdi32.CreateCompatibleBitmap(h_dc, w, h)
            old_obj = gdi32.SelectObject(h_mem, h_bmp)

            success = gdi32.BitBlt(h_mem, 0, 0, w, h, h_dc, 0, 0, SRCCOPY)
            if not success:
                gdi32.SelectObject(h_mem, old_obj)
                user32.ReleaseDC(None, h_dc)
                gdi32.DeleteDC(h_mem)
                gdi32.DeleteObject(h_bmp)
                return False, None, "BitBlt screen copy operation failed (display locked or compositing suspended)."

            bmi = BITMAPINFO()
            bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bmi.bmiHeader.biWidth = w
            bmi.bmiHeader.biHeight = -h  # top-down DIB
            bmi.bmiHeader.biPlanes = 1
            bmi.bmiHeader.biBitCount = 32
            bmi.bmiHeader.biCompression = 0

            raw_bytes = ctypes.create_string_buffer(w * h * 4)
            lines = gdi32.GetDIBits(h_dc, h_bmp, 0, h, raw_bytes, ctypes.byref(bmi), 0)

            # Release GDI objects immediately
            gdi32.SelectObject(h_mem, old_obj)
            user32.ReleaseDC(None, h_dc)
            gdi32.DeleteDC(h_mem)
            gdi32.DeleteObject(h_bmp)

            if lines != h:
                return False, None, f"GetDIBits incomplete ({lines}/{h} scanlines)."

            from PIL import Image
            img = Image.frombuffer("RGBA", (w, h), raw_bytes, "raw", "BGRA", 0, 1)
            return True, self._compress_to_jpeg_b64(img), None

        except Exception as e:
            logger.exception(f"[Screenshot] Capture error: {e}")
            return False, None, f"Screenshot error: {e}"
        finally:
            if old_desk and h_desk:
                try:
                    user32.SetThreadDesktop(old_desk)
                except Exception:
                    pass
            if h_desk:
                try:
                    user32.CloseDesktop(h_desk)
                except Exception:
                    pass


class NetworkDiscoveryEngine:
    """Discovers local network (LAN) devices and Tailscale mesh peers safely."""

    def __init__(self):
        self._cached_devices: List[NetworkDevice] = []
        self._last_scan: float = 0.0

    def get_network_devices(self, max_cache_age_sec: float = 8.0) -> List[NetworkDevice]:
        now = time.time()
        if self._cached_devices and (now - self._last_scan < max_cache_age_sec):
            return self._cached_devices

        devices: List[NetworkDevice] = []
        seen_ips: Set[str] = set()

        # 1. Local Workstation (Current Host)
        try:
            from pc_agent.config import get_local_ip, get_tailscale_ip
            local_lan_ip = get_local_ip()
            ts_ip = get_tailscale_ip()
        except Exception:
            local_lan_ip = "127.0.0.1"
            ts_ip = None

        devices.append(NetworkDevice(
            id="host_workstation",
            ip=local_lan_ip or "127.0.0.1",
            hostname="DESK OS Host PC (Workstation)",
            mac=None,
            device_type="host",
            is_current_host=True,
            is_tailscale=False,
            status="ONLINE",
            os="Windows 11",
            last_seen=now
        ))
        if local_lan_ip:
            seen_ips.add(local_lan_ip)
        if ts_ip:
            seen_ips.add(ts_ip)
        seen_ips.add("127.0.0.1")

        # 2. Tailscale Peers via CLI (local JSON query)
        ts_exe = Path(r"C:\Program Files\Tailscale\tailscale.exe")
        if not ts_exe.is_file():
            ts_exe = Path(os.path.expandvars(r"%LOCALAPPDATA%\Tailscale\tailscale.exe"))

        if ts_exe.is_file():
            try:
                proc = subprocess.run(
                    [str(ts_exe), "status", "--json"],
                    capture_output=True,
                    text=True,
                    timeout=3,
                    shell=False
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    data = json.loads(proc.stdout)
                    peers = data.get("Peer", {})
                    for p_id, p_info in peers.items():
                        p_ips = p_info.get("TailscaleIPs", [])
                        peer_ip = p_ips[0] if p_ips else None
                        if peer_ip and peer_ip not in seen_ips:
                            seen_ips.add(peer_ip)
                            h_name = p_info.get("HostName", "Tailscale Device")
                            is_online = bool(p_info.get("Online", False))
                            p_os = p_info.get("OS", "Unknown")
                            devices.append(NetworkDevice(
                                id=f"ts_{p_id[:10]}",
                                ip=peer_ip,
                                hostname=f"{h_name} ({p_os.capitalize()})",
                                mac=None,
                                device_type="tailscale_peer",
                                is_current_host=False,
                                is_tailscale=True,
                                status="ONLINE" if is_online else "OFFLINE",
                                os=p_os,
                                last_seen=now
                            ))
            except Exception as e:
                logger.debug(f"[NetworkDiscovery] Tailscale query error: {e}")

        # 3. Local Subnet ARP Cache Scan (Safe, instant, read-only cache)
        try:
            import re
            proc = subprocess.run(["arp", "-a"], capture_output=True, text=True, timeout=3, shell=False)
            if proc.returncode == 0:
                for line in proc.stdout.splitlines():
                    parts = line.strip().split()
                    if len(parts) >= 3:
                        ip, mac = parts[0], parts[1]
                        if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip):
                            if ip.endswith(".255") or ip.startswith("224.") or ip.startswith("239.") or ip == "255.255.255.255":
                                continue
                            if ip in seen_ips:
                                continue
                            seen_ips.add(ip)
                            is_router = ip.endswith(".1")
                            dev_name = "Default Gateway / Router" if is_router else f"LAN Device ({ip})"
                            devices.append(NetworkDevice(
                                id=f"lan_{ip.replace('.', '_')}",
                                ip=ip,
                                hostname=dev_name,
                                mac=mac if mac != "---" else None,
                                device_type="router" if is_router else "lan_device",
                                is_current_host=False,
                                is_tailscale=False,
                                status="ONLINE",
                                os=None,
                                last_seen=now
                            ))
        except Exception as e:
            logger.debug(f"[NetworkDiscovery] ARP scan error: {e}")

        self._cached_devices = devices
        self._last_scan = now
        return devices


class WorkstationController:
    """Controls workstation security lock."""

    @staticmethod
    def lock() -> Tuple[bool, str]:
        try:
            ret = user32.LockWorkStation()
            return (True, "Workstation locked.") if ret != 0 else (False, "LockWorkStation returned 0.")
        except Exception as e:
            return False, f"Failed to lock workstation: {e}"
        except Exception as e:
            return False, f"Failed to lock workstation: {e}"
