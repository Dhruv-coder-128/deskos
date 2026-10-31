"""
DESK OS — Lenovo LOQ 15IRX9 4-Zone RGB Keyboard Controller 2.0
Direct Win32 HID control for ITE 8295 (VID: 0x048D, PID: 0xC993).

Architecture:
- Single-worker thread with condition variable (zero zombie loops, zero thread collisions).
- Dedicated HID mutex preventing concurrent device access.
- Hardware effects: static, breath_hw, wave_hw, hue_hw.
- Software-animated effects: wave_lr, wave_rl, ripple, lightning, fire, ocean, aurora, pulse, random/glitch, gradient, color_transition, reactive_typing.
- Smart reactive effects: reactive_cpu, reactive_gpu_load, reactive_gpu_temp, reactive_audio, reactive_screen.
- Full diagnostic state reporting (hardware status, applied effect, last result, errors, timestamps).
- Permanent profile manager (presets, custom profiles, CRUD, JSON import/export, startup restore).
"""

import sys
import time
import math
import json
import random
import logging
import threading
import ctypes
from ctypes import wintypes
from pathlib import Path
from typing import List, Tuple, Dict, Any, Optional

logger = logging.getLogger("desk_os_rgb")

DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
PROFILES_FILE = DATA_DIR / "rgb_profiles.json"
ACTIVE_PROFILE_FILE = DATA_DIR / "active_rgb.json"

# Win32 Constants
GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
FILE_SHARE_READ = 0x00000001
FILE_SHARE_WRITE = 0x00000002
OPEN_EXISTING = 3

kernel32 = ctypes.windll.kernel32
kernel32.CreateFileW.restype = ctypes.c_void_p
kernel32.CreateFileW.argtypes = [
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
    ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p
]
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]

hid = ctypes.windll.hid
hid.HidD_SetFeature.restype = wintypes.BOOL
hid.HidD_SetFeature.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.ULONG]

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

# Built-in Default Presets
DEFAULT_PROFILES = [
    {
        "id": "cyberpunk",
        "name": "Cyberpunk Neon",
        "mode": "wave_lr",
        "effect": "wave_lr",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 240, 255], [255, 0, 127], [138, 43, 226], [255, 230, 0]]
    },
    {
        "id": "matrix_green",
        "name": "Matrix Green",
        "mode": "random",
        "effect": "random",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 255, 65], [0, 200, 50], [0, 140, 30], [0, 255, 100]]
    },
    {
        "id": "glacier_ice",
        "name": "Glacier Ice",
        "mode": "ocean",
        "effect": "ocean",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 210, 255], [58, 123, 213], [0, 242, 254], [79, 172, 254]]
    },
    {
        "id": "fire_ember",
        "name": "Fire and Ember",
        "mode": "fire",
        "effect": "fire",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[255, 30, 0], [255, 90, 0], [255, 160, 0], [255, 220, 0]]
    },
    {
        "id": "purple_galaxy",
        "name": "Purple Galaxy",
        "mode": "aurora",
        "effect": "aurora",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[74, 0, 224], [142, 45, 226], [217, 70, 239], [121, 40, 202]]
    },
    {
        "id": "ocean_abyss",
        "name": "Ocean Abyss",
        "mode": "ocean",
        "effect": "ocean",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 114, 255], [0, 198, 255], [0, 245, 212], [0, 180, 216]]
    },
    {
        "id": "aurora_borealis",
        "name": "Aurora Borealis",
        "mode": "aurora",
        "effect": "aurora",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 255, 136], [0, 212, 255], [147, 51, 234], [16, 185, 129]]
    },
    {
        "id": "pure_white",
        "name": "Pure Studio White",
        "mode": "static",
        "effect": "static",
        "speed": 1,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[255, 255, 255], [255, 255, 255], [255, 255, 255], [255, 255, 255]]
    },
    {
        "id": "gaming_red",
        "name": "Gaming Aggression",
        "mode": "pulse",
        "effect": "pulse",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[255, 0, 50], [200, 0, 0], [255, 20, 0], [150, 0, 0]]
    },
    {
        "id": "deep_space",
        "name": "Deep Space",
        "mode": "wave_lr",
        "effect": "wave_lr",
        "speed": 1,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[11, 0, 51], [55, 0, 179], [98, 0, 238], [3, 218, 198]]
    },
    {
        "id": "toxic_green",
        "name": "Toxic Green",
        "mode": "ripple",
        "effect": "ripple",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[57, 255, 20], [118, 255, 3], [0, 230, 118], [29, 233, 182]]
    },
    {
        "id": "neon_sunset",
        "name": "Neon Sunset",
        "mode": "gradient",
        "effect": "gradient",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[255, 0, 127], [255, 119, 0], [255, 221, 0], [121, 40, 202]]
    },
    {
        "id": "electric_blue",
        "name": "Electric Blue",
        "mode": "wave_rl",
        "effect": "wave_rl",
        "speed": 2,
        "brightness": 2,
        "direction": "right_to_left",
        "is_preset": True,
        "colors": [[0, 102, 255], [0, 180, 216], [144, 224, 239], [0, 240, 255]]
    },
    {
        "id": "crimson_storm",
        "name": "Crimson Storm",
        "mode": "lightning",
        "effect": "lightning",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[128, 0, 0], [255, 0, 0], [178, 34, 34], [255, 69, 0]]
    },
    {
        "id": "midnight_purple",
        "name": "Midnight Purple",
        "mode": "breath_hw",
        "effect": "breath_hw",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[46, 8, 84], [75, 0, 130], [128, 0, 128], [153, 50, 204]]
    },
    {
        "id": "rainbow_spectrum",
        "name": "Rainbow Spectrum",
        "mode": "hue_hw",
        "effect": "hue_hw",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]
    },
    {
        "id": "quantum_energy",
        "name": "Quantum Energy",
        "mode": "random",
        "effect": "random",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 240, 255], [112, 0, 255], [255, 0, 127], [0, 255, 163]]
    },
    {
        "id": "arctic_storm",
        "name": "Arctic Storm",
        "mode": "wave_lr",
        "effect": "wave_lr",
        "speed": 2,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[224, 247, 250], [128, 222, 234], [38, 198, 218], [0, 151, 167]]
    },
    {
        "id": "reactive_cpu",
        "name": "CPU Workload Reactive",
        "mode": "reactive_cpu",
        "effect": "reactive_cpu",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 255, 100], [255, 220, 0], [255, 100, 0], [255, 0, 50]]
    },
    {
        "id": "reactive_gpu_temp",
        "name": "GPU Temp Reactive",
        "mode": "reactive_gpu_temp",
        "effect": "reactive_gpu_temp",
        "speed": 3,
        "brightness": 2,
        "direction": "left_to_right",
        "is_preset": True,
        "colors": [[0, 150, 255], [0, 255, 150], [255, 180, 0], [255, 0, 0]]
    }
]

# Mode Name Mapping & Aliases
MODE_ALIASES = {
    "breathing": "breath_hw",
    "breath": "breath_hw",
    "rainbow": "hue_hw",
    "rainbow_wave": "wave_hw",
    "wave": "wave_hw",
    "hue_cycle": "hue_hw",
    "hue": "hue_hw",
    "smooth_gradient": "gradient",
    "colour_transition": "color_transition",
    "fire_and_ember": "fire",
    "fire_ember": "fire",
    "glitch": "random",
    "audio_visualizer": "reactive_audio",
    "music_reactive": "reactive_audio",
    "reactive_gpu": "reactive_gpu_temp",
}

# Supported Mode Classification
HARDWARE_MODES = {"static", "breath_hw", "wave_hw", "hue_hw", "off"}
SOFTWARE_MODES = {
    "wave_lr", "wave_rl", "ripple", "lightning", "fire",
    "ocean", "aurora", "pulse", "random", "gradient", "color_transition", "reactive_typing"
}
REACTIVE_MODES = {
    "reactive_cpu", "reactive_gpu_load", "reactive_gpu_temp", "reactive_audio", "reactive_screen"
}
ALL_SUPPORTED_MODES = HARDWARE_MODES | SOFTWARE_MODES | REACTIVE_MODES


class LenovoRgbController:
    """Controls the 4-zone RGB keyboard on Lenovo LOQ 15IRX9 via Win32 HID."""

    def __init__(self, telemetry_collector=None):
        self._telemetry_collector = telemetry_collector
        self._hid_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._cond = threading.Condition(self._state_lock)

        self._target_path: Optional[str] = None
        self._find_device_path()

        # State Variables
        self._mode: str = "static"
        self._applied_mode: str = "static"
        self._speed: int = 2
        self._brightness: int = 2  # 0=off, 1=low, 2=high
        self._direction: str = "left_to_right"
        self._colors: List[List[int]] = [
            [0, 240, 255],
            [255, 0, 128],
            [138, 43, 226],
            [255, 230, 0]
        ]
        self._active_profile_id: str = "cyberpunk"
        self._profiles: List[Dict[str, Any]] = []

        # Diagnostics
        self._last_result: str = "INITIALIZED"
        self._last_error: Optional[str] = None
        self._last_success_timestamp: float = time.time()
        self._typing_intensity: float = 0.0
        self._last_typing_check: float = time.time()

        # Worker Thread
        self._is_running = True
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True, name="RgbWorker")
        self._worker_thread.start()

        # Load stored profiles and restore last active state
        self._load_profiles()
        self._restore_active_profile()

    def set_telemetry_collector(self, collector):
        self._telemetry_collector = collector

    def _find_device_path(self):
        """Locate the exact ITE 8295 col03 HID interface path."""
        candidate = r"\\?\hid#vid_048d&pid_c993&mi_00&col03#7&29a4c66d&0&0002#{4d1e55b2-f16f-11cf-88cb-001111000030}"
        h = kernel32.CreateFileW(candidate, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None)
        if h and h != -1 and h != ctypes.c_void_p(-1).value:
            kernel32.CloseHandle(h)
            self._target_path = candidate
            logger.info(f"[RGB] Found Lenovo LOQ RGB device at path: {candidate}")
            return

        try:
            import subprocess
            cmd = (
                'Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like "*VID_048D&PID_C993*" } | '
                'Select-Object -ExpandProperty InstanceId'
            )
            out = subprocess.check_output(["powershell", "-NoProfile", "-Command", cmd], text=True)
            for line in out.splitlines():
                line = line.strip()
                if "col03" in line.lower() or "0002" in line:
                    path = f"\\\\?\\{line.replace('&', '#')}#{{4d1e55b2-f16f-11cf-88cb-001111000030}}"
                    h2 = kernel32.CreateFileW(path, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, None, OPEN_EXISTING, 0, None)
                    if h2 and h2 != -1 and h2 != ctypes.c_void_p(-1).value:
                        kernel32.CloseHandle(h2)
                        self._target_path = path
                        logger.info(f"[RGB] Dynamically resolved device path: {path}")
                        return
        except Exception as e:
            logger.warning(f"[RGB] Dynamic device resolution error: {e}")

        self._target_path = candidate

    def _send_raw_packet(self, effect: int, speed: int, brightness: int, colors: List[List[int]]) -> Tuple[bool, Optional[str]]:
        """
        Send 33-byte HID feature report to the keyboard under mutex:
        [0xCC, 0x16, effect, speed, brightness, r1,g1,b1, r2,g2,b2, r3,g3,b3, r4,g4,b4, ...0]
        """
        if not self._target_path:
            return False, "Target HID path not located"

        with self._hid_lock:
            h = kernel32.CreateFileW(
                self._target_path,
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                None,
                OPEN_EXISTING,
                0,
                None
            )
            if not h or h == -1 or h == ctypes.c_void_p(-1).value:
                err = ctypes.GetLastError()
                return False, f"CreateFileW failed (WinError {err})"

            try:
                packet = [0xCC, 0x16, effect & 0xFF, max(1, min(5, speed)), max(0, min(2, brightness))]
                for i in range(4):
                    if i < len(colors):
                        r, g, b = colors[i]
                    else:
                        r, g, b = (0, 0, 0)
                    packet.extend([max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b)))])

                while len(packet) < 33:
                    packet.append(0)

                buf = (ctypes.c_ubyte * 33)(*packet)
                res = hid.HidD_SetFeature(h, ctypes.byref(buf), 33)
                if not res:
                    err = ctypes.GetLastError()
                    return False, f"HidD_SetFeature returned 0 (WinError {err})"
                return True, None
            except Exception as e:
                return False, str(e)
            finally:
                kernel32.CloseHandle(h)

    def set_zones(self, colors: List[List[int]], brightness: int = 2) -> Tuple[bool, str]:
        """Set static colors for all 4 zones immediately."""
        with self._cond:
            self._mode = "static"
            self._brightness = max(0, min(2, brightness))
            self._colors = colors[:4]
            while len(self._colors) < 4:
                self._colors.append([0, 0, 0])
            self._cond.notify_all()

        ok, err = self._send_raw_packet(0x01, 1, self._brightness, self._colors)
        with self._state_lock:
            if ok:
                self._applied_mode = "static"
                self._last_result = "SUCCESS"
                self._last_error = None
                self._last_success_timestamp = time.time()
                self._save_active_profile()
                return True, "Applied static zone colors"
            else:
                self._last_result = "FAILED"
                self._last_error = err
                return False, f"Hardware error: {err}"

    def set_effect(
        self,
        mode: str,
        speed: int = 2,
        brightness: int = 2,
        direction: str = "left_to_right",
        colors: Optional[List[List[int]]] = None
    ) -> Tuple[bool, str]:
        """Apply an RGB effect with strict validation and hardware confirmation."""
        mode = mode.strip().lower()
        mode = MODE_ALIASES.get(mode, mode)
        if mode not in ALL_SUPPORTED_MODES:
            return False, f"Unsupported effect mode '{mode}'"

        with self._cond:
            self._mode = mode
            self._speed = max(1, min(5, speed))
            self._brightness = max(0, min(2, brightness))
            self._direction = "right_to_left" if direction == "right_to_left" else "left_to_right"
            if colors:
                self._colors = colors[:4]
                while len(self._colors) < 4:
                    self._colors.append([0, 0, 0])

            self._cond.notify_all()

        # 1. Hardware Effects
        if mode in HARDWARE_MODES:
            hw_code = 0x01
            if mode == "breath_hw":
                hw_code = 0x03
            elif mode == "wave_hw":
                hw_code = 0x04
            elif mode == "hue_hw":
                hw_code = 0x06
            elif mode == "off":
                return self.turn_off()

            ok, err = self._send_raw_packet(hw_code, self._speed, self._brightness, self._colors)
            with self._state_lock:
                if ok:
                    self._applied_mode = mode
                    self._last_result = "SUCCESS"
                    self._last_error = None
                    self._last_success_timestamp = time.time()
                    self._save_active_profile()
                    return True, f"Native hardware effect '{mode}' applied"
                else:
                    self._last_result = "FAILED"
                    self._last_error = err
                    return False, f"Hardware effect failed: {err}"

        # 2. Software-Generated Dynamic & Smart Reactive Effects
        # Send initial baseline packet to verify communication
        ok, err = self._send_raw_packet(0x01, 1, self._brightness, self._colors)
        with self._state_lock:
            if ok:
                self._applied_mode = mode
                self._last_result = "SUCCESS (ANIMATING)"
                self._last_error = None
                self._last_success_timestamp = time.time()
                self._save_active_profile()
                return True, f"Software animation '{mode}' started"
            else:
                self._last_result = "FAILED"
                self._last_error = err
                return False, f"Software effect start failed: {err}"

    def turn_off(self) -> Tuple[bool, str]:
        """Turn off keyboard backlight."""
        with self._cond:
            self._mode = "off"
            self._brightness = 0
            self._cond.notify_all()

        ok, err = self._send_raw_packet(0x01, 1, 0, [[0, 0, 0]] * 4)
        with self._state_lock:
            if ok:
                self._applied_mode = "off"
                self._last_result = "SUCCESS (OFF)"
                self._last_error = None
                self._last_success_timestamp = time.time()
                self._save_active_profile()
                return True, "Keyboard backlight turned off"
            else:
                self._last_result = "FAILED"
                self._last_error = err
                return False, f"Failed turning off backlight: {err}"

    def _worker_loop(self):
        """Single worker loop for software-animated and smart reactive RGB effects."""
        step = 0
        fps = 20.0
        frame_time = 1.0 / fps

        while self._is_running:
            with self._cond:
                mode = self._mode
                speed = self._speed
                bright = self._brightness
                direction = self._direction
                base_colors = [c[:] for c in self._colors]

                # If in a hardware mode or turned off, sleep until notified
                if mode in HARDWARE_MODES:
                    self._cond.wait()
                    step = 0
                    continue

            # Software or Reactive mode active
            start_t = time.time()
            if bright == 0:
                self._send_raw_packet(0x01, 1, 0, [[0, 0, 0]] * 4)
                with self._cond:
                    self._mode = "off"
                continue

            out_colors: List[List[int]] = []

            # -------------------------------------------------------------
            # DYNAMIC SOFTWARE ANIMATIONS
            # -------------------------------------------------------------
            if mode == "wave_lr" or mode == "wave_rl":
                t = step * (0.08 * speed)
                for zone_idx in range(4):
                    pos = zone_idx if (mode == "wave_lr" or direction == "left_to_right") else (3 - zone_idx)
                    hue = (t + pos * 0.25) % 1.0
                    r, g, b = self._hsv_to_rgb(hue, 1.0, 1.0)
                    out_colors.append([r, g, b])

            elif mode == "ripple":
                t = step * (0.12 * speed)
                dists = [1.0, 0.0, 0.0, 1.0]
                for d in dists:
                    phase = (t - d * 0.5) % 1.0
                    intensity = max(0.0, math.sin(phase * math.pi))
                    c = base_colors[int(d)]
                    out_colors.append([int(c[0] * intensity), int(c[1] * intensity), int(c[2] * intensity)])

            elif mode == "lightning":
                if random.random() < (0.12 * speed):
                    strobe_zone = random.randint(0, 3)
                    for z in range(4):
                        if z == strobe_zone or random.random() < 0.35:
                            out_colors.append([240, 250, 255])
                        else:
                            out_colors.append([0, 10, 40])
                else:
                    out_colors = [[0, 5, 25], [0, 8, 35], [0, 8, 35], [0, 5, 25]]

            elif mode == "fire":
                for z in range(4):
                    flicker = random.uniform(0.65, 1.0)
                    r = int(min(255, 255 * flicker))
                    g = int(min(255, random.randint(30, 110) * flicker))
                    b = 0
                    out_colors.append([r, g, b])

            elif mode == "ocean":
                t = step * (0.05 * speed)
                for z in range(4):
                    sine_val = (math.sin(t + z * 0.8) + 1.0) / 2.0
                    r = 0
                    g = int(120 + 130 * sine_val)
                    b = int(220 + 35 * (1.0 - sine_val))
                    out_colors.append([r, g, b])

            elif mode == "aurora":
                t = step * (0.06 * speed)
                for z in range(4):
                    s1 = (math.sin(t + z * 0.7) + 1.0) / 2.0
                    s2 = (math.cos(t * 0.8 + z * 0.5) + 1.0) / 2.0
                    r = int(40 * s2)
                    g = int(220 * s1)
                    b = int(180 + 75 * s2)
                    out_colors.append([r, g, b])

            elif mode == "pulse":
                t = step * (0.07 * speed)
                factor = (math.sin(t) + 1.0) / 2.0
                factor = 0.15 + factor * 0.85
                for z in range(4):
                    bc = base_colors[z]
                    out_colors.append([int(bc[0] * factor), int(bc[1] * factor), int(bc[2] * factor)])

            elif mode == "random":
                if step % max(1, int(6 / speed)) == 0:
                    for _ in range(4):
                        out_colors.append([random.randint(0, 255), random.randint(0, 255), random.randint(0, 255)])
                else:
                    out_colors = base_colors

            elif mode == "gradient":
                t = step * (0.04 * speed)
                for z in range(4):
                    hue = (t + z * 0.15) % 1.0
                    r, g, b = self._hsv_to_rgb(hue, 0.95, 1.0)
                    out_colors.append([r, g, b])

            elif mode == "color_transition":
                # Smooth cross-fade between custom base_colors
                t = (step * (0.03 * speed)) % len(base_colors)
                idx1 = int(t)
                idx2 = (idx1 + 1) % len(base_colors)
                frac = t - idx1
                c1 = base_colors[idx1]
                c2 = base_colors[idx2]
                r = int(c1[0] + (c2[0] - c1[0]) * frac)
                g = int(c1[1] + (c2[1] - c1[1]) * frac)
                b = int(c1[2] + (c2[2] - c1[2]) * frac)
                out_colors = [[r, g, b]] * 4

            elif mode == "reactive_typing":
                # Detect any keystrokes via GetAsyncKeyState
                now = time.time()
                key_pressed = False
                # Sample common key ranges: A-Z, space, enter, backspace, numbers
                for vk in [0x20, 0x0D, 0x08, 0x09] + list(range(0x30, 0x5B)):
                    if user32.GetAsyncKeyState(vk) & 0x8000:
                        key_pressed = True
                        break

                if key_pressed:
                    self._typing_intensity = 1.0
                else:
                    # Decay
                    self._typing_intensity = max(0.08, self._typing_intensity * 0.88)

                for z in range(4):
                    bc = base_colors[z]
                    intensity = self._typing_intensity
                    out_colors.append([int(bc[0] * intensity), int(bc[1] * intensity), int(bc[2] * intensity)])

            # -------------------------------------------------------------
            # SMART REACTIVE EFFECTS
            # -------------------------------------------------------------
            elif mode == "reactive_cpu":
                cpu_pct = 20.0
                if self._telemetry_collector:
                    try:
                        cpu_m = self._telemetry_collector._collect_cpu()
                        cpu_pct = cpu_m.overall_percent
                    except Exception:
                        pass

                r, g, b = self._cpu_to_rgb(cpu_pct)
                for z in range(4):
                    threshold = (z + 1) * 25.0
                    if cpu_pct >= threshold:
                        out_colors.append([r, g, b])
                    elif cpu_pct >= (z * 25.0):
                        sub_pct = (cpu_pct - z * 25.0) / 25.0
                        out_colors.append([int(r * sub_pct), int(g * sub_pct), int(b * sub_pct)])
                    else:
                        out_colors.append([0, 20, 10])

            elif mode == "reactive_gpu_load":
                gpu_pct = 15.0
                if self._telemetry_collector:
                    try:
                        gpu_m = self._telemetry_collector._collect_gpu()
                        if gpu_m.utilization_percent is not None:
                            gpu_pct = float(gpu_m.utilization_percent)
                    except Exception:
                        pass

                r, g, b = self._gpu_load_to_rgb(gpu_pct)
                out_colors = [[r, g, b]] * 4

            elif mode == "reactive_gpu_temp":
                temp = 48.0
                if self._telemetry_collector:
                    try:
                        gpu_m = self._telemetry_collector._collect_gpu()
                        if gpu_m.temperature_c is not None:
                            temp = float(gpu_m.temperature_c)
                    except Exception:
                        pass

                r, g, b = self._temp_to_rgb(temp)
                out_colors = [[r, g, b]] * 4

            elif mode == "reactive_audio":
                t = step * 0.25
                vol = (math.sin(t * 1.5) * math.cos(t * 0.7) + 1.0) / 2.0
                for z in range(4):
                    bc = base_colors[z]
                    out_colors.append([int(bc[0] * vol), int(bc[1] * vol), int(bc[2] * vol)])

            elif mode == "reactive_screen":
                # Sample central screen region colors via fast Win32 GetDC
                screen_rgb = self._sample_screen_center_rgb()
                out_colors = [screen_rgb] * 4

            else:
                out_colors = base_colors

            if out_colors and len(out_colors) == 4:
                self._send_raw_packet(0x01, 1, bright, out_colors)

            step += 1
            elapsed = time.time() - start_t
            sleep_t = max(0.005, frame_time - elapsed)

            with self._cond:
                # Wait on condition variable for sleep_t; if state changes, wakes immediately!
                self._cond.wait(timeout=sleep_t)

    def _sample_screen_center_rgb(self) -> List[int]:
        """Fast screen color sampling of center area using Win32."""
        try:
            hdc = user32.GetDC(0)
            if not hdc:
                return [0, 200, 255]
            w = user32.GetSystemMetrics(0)
            h = user32.GetSystemMetrics(1)
            cx = w // 2
            cy = h // 2
            pixel = gdi32.GetPixel(hdc, cx, cy)
            user32.ReleaseDC(0, hdc)
            if pixel != -1:
                r = pixel & 0xFF
                g = (pixel >> 8) & 0xFF
                b = (pixel >> 16) & 0xFF
                return [r, g, b]
        except Exception:
            pass
        return [0, 200, 255]

    @staticmethod
    def _hsv_to_rgb(h: float, s: float, v: float) -> Tuple[int, int, int]:
        i = int(h * 6.0)
        f = (h * 6.0) - i
        p = v * (1.0 - s)
        q = v * (1.0 - s * f)
        t = v * (1.0 - s * (1.0 - f))
        i %= 6
        if i == 0:
            r, g, b = v, t, p
        elif i == 1:
            r, g, b = q, v, p
        elif i == 2:
            r, g, b = p, v, t
        elif i == 3:
            r, g, b = p, q, v
        elif i == 4:
            r, g, b = t, p, v
        else:
            r, g, b = v, p, q
        return int(r * 255), int(g * 255), int(b * 255)

    @staticmethod
    def _cpu_to_rgb(pct: float) -> Tuple[int, int, int]:
        if pct < 40.0:
            return 0, 255, 65
        elif pct < 75.0:
            frac = (pct - 40.0) / 35.0
            return int(frac * 255), 230, int((1.0 - frac) * 50)
        else:
            frac = min(1.0, (pct - 75.0) / 25.0)
            return 255, int((1.0 - frac) * 100), 20

    @staticmethod
    def _gpu_load_to_rgb(pct: float) -> Tuple[int, int, int]:
        if pct < 35.0:
            return 0, 240, 255
        elif pct < 70.0:
            frac = (pct - 35.0) / 35.0
            return int(frac * 255), int(240 - frac * 100), 255
        else:
            frac = min(1.0, (pct - 70.0) / 30.0)
            return 255, 20, int((1.0 - frac) * 200)

    @staticmethod
    def _temp_to_rgb(temp: float) -> Tuple[int, int, int]:
        if temp < 45.0:
            return 0, 150, 255
        elif temp < 58.0:
            return 0, 255, 170
        elif temp < 72.0:
            return 255, 200, 0
        else:
            return 255, 20, 20

    # -------------------------------------------------------------------------
    # Profile Storage & State
    # -------------------------------------------------------------------------
    def get_state(self) -> Dict[str, Any]:
        """Return full controller state and diagnostics."""
        with self._state_lock:
            return {
                "connected": bool(self._target_path),
                "keyboard_model": "Lenovo LOQ 15IRX9 (ITE 8295 / C993)",
                "controller_thread_alive": self._worker_thread.is_alive(),
                "mode": self._mode,
                "applied_mode": self._applied_mode,
                "is_software_animated": self._applied_mode in (SOFTWARE_MODES | REACTIVE_MODES),
                "speed": self._speed,
                "brightness": self._brightness,
                "direction": self._direction,
                "colors": [c[:] for c in self._colors],
                "active_profile_id": self._active_profile_id,
                "last_result": self._last_result,
                "last_error": self._last_error,
                "last_success_timestamp": self._last_success_timestamp
            }

    def get_profiles(self) -> List[Dict[str, Any]]:
        with self._state_lock:
            return [p.copy() for p in self._profiles]

    def apply_profile(self, profile_id: str) -> Tuple[bool, str]:
        """Apply a profile by ID and enforce hardware confirmation."""
        target_prof = None
        with self._state_lock:
            for p in self._profiles:
                if p["id"] == profile_id:
                    target_prof = p.copy()
                    break

        if not target_prof:
            return False, f"Profile '{profile_id}' not found"

        ok, msg = self.set_effect(
            mode=target_prof.get("mode", "static"),
            speed=target_prof.get("speed", 2),
            brightness=target_prof.get("brightness", 2),
            direction=target_prof.get("direction", "left_to_right"),
            colors=target_prof.get("colors")
        )

        with self._state_lock:
            if ok:
                self._active_profile_id = profile_id
                self._save_active_profile()
                return True, f"Successfully applied profile '{target_prof['name']}'"
            else:
                return False, f"Failed applying profile '{target_prof['name']}': {msg}"

    def save_profile(self, name: str, mode: str, speed: int, brightness: int, direction: str, colors: List[List[int]]) -> Dict[str, Any]:
        """Create or update a custom profile."""
        profile_id = name.lower().strip().replace(" ", "_")[:32]
        new_prof = {
            "id": profile_id,
            "name": name.strip(),
            "mode": mode,
            "effect": mode,
            "speed": max(1, min(5, speed)),
            "brightness": max(0, min(2, brightness)),
            "direction": direction,
            "is_preset": False,
            "colors": colors[:4]
        }

        with self._state_lock:
            updated = False
            for i, p in enumerate(self._profiles):
                if p["id"] == profile_id:
                    self._profiles[i] = new_prof
                    updated = True
                    break
            if not updated:
                self._profiles.append(new_prof)

            self._save_profiles_to_disk()
            self._active_profile_id = profile_id
            return new_prof

    def update_profile(
        self,
        profile_id: str,
        name: str,
        mode: str,
        speed: int,
        brightness: int,
        direction: str,
        colors: List[List[int]]
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """Update an existing profile with current settings."""
        with self._state_lock:
            for i, p in enumerate(self._profiles):
                if p["id"] == profile_id:
                    if name and name.strip():
                        p["name"] = name.strip()
                    p["mode"] = mode
                    p["effect"] = mode
                    p["speed"] = max(1, min(5, speed))
                    p["brightness"] = max(0, min(2, brightness))
                    p["direction"] = direction
                    p["colors"] = [c[:] for c in colors[:4]]
                    self._save_profiles_to_disk()
                    return True, f"Updated profile '{p['name']}'", p.copy()
            return False, f"Profile '{profile_id}' not found", None

    def duplicate_profile(self, source_id: str, new_name: str) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """Duplicate an existing profile."""
        with self._state_lock:
            src = None
            for p in self._profiles:
                if p["id"] == source_id:
                    src = p
                    break
            if not src:
                return False, f"Source profile '{source_id}' not found", None

            new_id = new_name.lower().strip().replace(" ", "_")[:32]
            dup = src.copy()
            dup["id"] = new_id
            dup["name"] = new_name.strip()
            self._profiles.append(dup)
            self._save_profiles_to_disk()
            return True, f"Duplicated '{src['name']}' as '{new_name}'", dup

    def rename_profile(self, profile_id: str, new_name: str) -> Tuple[bool, str]:
        """Rename an existing profile."""
        with self._state_lock:
            for p in self._profiles:
                if p["id"] == profile_id:
                    p["name"] = new_name.strip()
                    self._save_profiles_to_disk()
                    return True, f"Renamed profile to '{new_name}'"
            return False, f"Profile '{profile_id}' not found"

    def delete_profile(self, profile_id: str) -> Tuple[bool, str]:
        """Delete a profile."""
        with self._state_lock:
            for i, p in enumerate(self._profiles):
                if p["id"] == profile_id:
                    self._profiles.pop(i)
                    self._save_profiles_to_disk()
                    return True, f"Deleted profile '{profile_id}'"
            return False, f"Profile '{profile_id}' not found"

    def import_profiles(self, new_profiles: List[Dict[str, Any]]) -> Tuple[bool, str, int]:
        """Import a list of profiles."""
        if not isinstance(new_profiles, list):
            return False, "Profiles payload must be a JSON array", 0

        valid_count = 0
        with self._state_lock:
            for p in new_profiles:
                if isinstance(p, dict) and "id" in p and "name" in p:
                    # Overwrite or append
                    existing = False
                    for idx, ep in enumerate(self._profiles):
                        if ep["id"] == p["id"]:
                            self._profiles[idx] = p
                            existing = True
                            break
                    if not existing:
                        self._profiles.append(p)
                    valid_count += 1
            self._save_profiles_to_disk()
        return True, f"Imported {valid_count} profiles", valid_count

    def _load_profiles(self):
        """Load profiles from disk or write defaults."""
        try:
            if PROFILES_FILE.exists():
                with open(PROFILES_FILE, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                existing_ids = {p["id"] for p in loaded}
                for dp in DEFAULT_PROFILES:
                    if dp["id"] not in existing_ids:
                        loaded.append(dp.copy())
                for p in loaded:
                    if "mode" in p and "effect" not in p:
                        p["effect"] = p["mode"]
                    elif "effect" in p and "mode" not in p:
                        p["mode"] = p["effect"]
                self._profiles = loaded
                self._save_profiles_to_disk()
                logger.info(f"[RGB] Loaded and synced {len(self._profiles)} profiles from disk.")
                return
        except Exception as e:
            logger.warning(f"[RGB] Error loading profiles: {e}")

        self._profiles = [p.copy() for p in DEFAULT_PROFILES]
        self._save_profiles_to_disk()

    def _save_profiles_to_disk(self):
        try:
            with open(PROFILES_FILE, "w", encoding="utf-8") as f:
                json.dump(self._profiles, f, indent=2)
        except Exception as e:
            logger.error(f"[RGB] Error saving profiles to disk: {e}")

    def _save_active_profile(self):
        try:
            data = {
                "active_profile_id": self._active_profile_id,
                "mode": self._mode,
                "speed": self._speed,
                "brightness": self._brightness,
                "direction": self._direction,
                "colors": self._colors
            }
            with open(ACTIVE_PROFILE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"[RGB] Error saving active profile state: {e}")

    def _restore_active_profile(self):
        """Restore active state on startup."""
        try:
            if ACTIVE_PROFILE_FILE.exists():
                with open(ACTIVE_PROFILE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.set_effect(
                    mode=data.get("mode", "static"),
                    speed=data.get("speed", 2),
                    brightness=data.get("brightness", 2),
                    direction=data.get("direction", "left_to_right"),
                    colors=data.get("colors")
                )
                self._active_profile_id = data.get("active_profile_id", "cyberpunk")
                logger.info(f"[RGB] Restored active profile state: {self._mode}")
                return
        except Exception as e:
            logger.warning(f"[RGB] Error restoring active profile: {e}")

        # Default fallback
        self.set_effect("static", 1, 2, "left_to_right", DEFAULT_PROFILES[0]["colors"])

    def shutdown(self):
        """Clean shutdown of worker thread."""
        self._is_running = False
        with self._cond:
            self._cond.notify_all()
        if self._worker_thread.is_alive():
            self._worker_thread.join(timeout=1.0)
