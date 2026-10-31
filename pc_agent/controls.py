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
    from pc_agent.models import AppInfo, DiscoveredApp, MediaState, RunningWindow
except ImportError:
    from models import AppInfo, DiscoveredApp, MediaState, RunningWindow

logger = logging.getLogger("desk_os_controls")

DATA_DIR = _AGENT_DIR / "data"
SCRIPTS_DIR = _AGENT_DIR / "scripts"
ALLOWLIST_PATH = DATA_DIR / "app_allowlist.json"

# Virtual Key Codes for Windows Media Control
VK_MEDIA_NEXT_TRACK = 0xB0
VK_MEDIA_PREV_TRACK = 0xB1
VK_MEDIA_STOP = 0xB2
VK_MEDIA_PLAY_PAUSE = 0xB3
KEYEVENTF_KEYUP = 0x0002

# Win32 Icon & Window Constants
user32 = ctypes.windll.user32
shell32 = ctypes.windll.shell32
gdi32 = ctypes.windll.gdi32
kernel32 = ctypes.windll.kernel32

user32.GetDC.restype = wintypes.HDC
user32.GetDC.argtypes = [wintypes.HWND]
user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
user32.DestroyIcon.argtypes = [wintypes.HICON]
gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]
gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, wintypes.LPVOID, ctypes.c_void_p, wintypes.UINT]

user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindow.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]

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

                discovered_windows.append(RunningWindow(
                    id=f"win_{hwnd}",
                    hwnd=hwnd,
                    title=title,
                    process_name=proc_name,
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
        if not user32.IsWindow(target_hwnd):
            return False, f"Window (HWND: {target_hwnd}) no longer exists."

        # 1. Restore if minimized
        if user32.IsIconic(target_hwnd):
            user32.ShowWindow(target_hwnd, 9)  # SW_RESTORE = 9

        # 2. Try direct activation
        user32.BringWindowToTop(target_hwnd)
        user32.SetForegroundWindow(target_hwnd)

        # 3. Bypass Windows foreground activation restrictions via AttachThreadInput if needed
        cur_fg = user32.GetForegroundWindow()
        if cur_fg != target_hwnd:
            fg_thread = user32.GetWindowThreadProcessId(cur_fg, None)
            cur_thread = kernel32.GetCurrentThreadId()
            if fg_thread and fg_thread != cur_thread:
                user32.AttachThreadInput(cur_thread, fg_thread, True)
                user32.BringWindowToTop(target_hwnd)
                user32.SetForegroundWindow(target_hwnd)
                user32.AttachThreadInput(cur_thread, fg_thread, False)

        # 4. Verify actual success
        now_fg = user32.GetForegroundWindow()
        if now_fg == target_hwnd:
            logger.info(f"[CONTROL] Focused window HWND={target_hwnd} successfully.")
            return True, "Window focused."
        else:
            logger.warning(f"[CONTROL] Focus requested for HWND={target_hwnd}, but active foreground is HWND={now_fg}")
            return True, "Window activation signaled to Windows."


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
    """Captures desktop screenshots on-demand, compressed for mobile delivery."""

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
        try:
            import mss
            from PIL import Image
            with mss.MSS() as sct:
                mon = sct.monitors[1] if len(sct.monitors) > 1 else sct.monitors[0]
                sct_img = sct.grab(mon)
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                return True, self._compress_to_jpeg_b64(img), None
        except Exception:
            pass

        try:
            from PIL import ImageGrab
            img = ImageGrab.grab(all_screens=False)
            return True, self._compress_to_jpeg_b64(img), None
        except Exception:
            pass

        return False, None, "Desktop window station inaccessible (screen locked or non-interactive service session)."


class WorkstationController:
    """Controls workstation security lock."""

    @staticmethod
    def lock() -> Tuple[bool, str]:
        try:
            ret = user32.LockWorkStation()
            return (True, "Workstation locked.") if ret != 0 else (False, "LockWorkStation returned 0.")
        except Exception as e:
            return False, f"Failed to lock workstation: {e}"
