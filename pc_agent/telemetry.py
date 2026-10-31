"""
DESK OS — PC Agent Live Telemetry Engine (Phase 4)
Gathers real-time CPU, GPU (NVIDIA NVML), RAM, Storage, Network rates, and Uptime.
Runs non-blocking collection and handles unsupported metrics gracefully.
"""

import sys
import time
import socket
import logging
import warnings
from pathlib import Path
from typing import Optional, List, Dict, Any

import psutil

# Suppress pynvml deprecation notice
warnings.filterwarnings("ignore", category=FutureWarning)

_AGENT_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _AGENT_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
if str(_AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(_AGENT_DIR))

try:
    from pc_agent.models import (
        CPUMetrics,
        GPUMetrics,
        RAMMetrics,
        StorageDrive,
        NetworkMetrics,
        SystemMetrics,
        TelemetryPayload
    )
except ImportError:
    from models import (
        CPUMetrics,
        GPUMetrics,
        RAMMetrics,
        StorageDrive,
        NetworkMetrics,
        SystemMetrics,
        TelemetryPayload
    )

logger = logging.getLogger("desk_os_telemetry")


class TelemetryCollector:
    """Non-blocking workstation telemetry engine for Windows 11."""

    def __init__(self):
        # 1. Prime non-blocking CPU baseline
        try:
            psutil.cpu_percent(interval=None)
            psutil.cpu_percent(percpu=True)
        except Exception as e:
            logger.warning(f"Failed to prime CPU counters: {e}")

        # 2. Prime Network speed counters
        self._last_net_time = time.time()
        try:
            net_io = psutil.net_io_counters()
            self._last_bytes_recv = net_io.bytes_recv
            self._last_bytes_sent = net_io.bytes_sent
        except Exception:
            self._last_bytes_recv = 0
            self._last_bytes_sent = 0

        # 3. Initialize NVIDIA NVML
        self._nvml_initialized = False
        self._nvml_handle = None
        self._gpu_name: Optional[str] = None
        self._init_nvml()

        # Cache static CPU topology
        try:
            self._core_physical = psutil.cpu_count(logical=False)
            self._core_logical = psutil.cpu_count(logical=True) or 1
        except Exception:
            self._core_physical = None
            self._core_logical = 1

        self._host_name = socket.gethostname()

    def _init_nvml(self):
        """Attempt to initialize NVIDIA NVML for RTX 3050 metrics."""
        try:
            import pynvml
            pynvml.nvmlInit()
            device_count = pynvml.nvmlDeviceGetCount()
            if device_count > 0:
                self._nvml_handle = pynvml.nvmlDeviceGetHandleByIndex(0)
                raw_name = pynvml.nvmlDeviceGetName(self._nvml_handle)
                self._gpu_name = raw_name if isinstance(raw_name, str) else raw_name.decode("utf-8")
                self._nvml_initialized = True
                logger.info(f"[Telemetry] NVIDIA NVML initialized: {self._gpu_name}")
        except Exception as e:
            self._nvml_initialized = False
            self._nvml_handle = None
            logger.info(f"[Telemetry] NVML unavailable ({e}). Fallback modes active.")

    def _get_cpu_temperature(self) -> Optional[float]:
        """
        Attempt to retrieve CPU temperature where supported.
        Gracefully returns None on Windows when elevated OEM/WMI privileges are absent.
        """
        # 1. psutil sensors (if supported on platform)
        if hasattr(psutil, "sensors_temperatures"):
            try:
                temps = psutil.sensors_temperatures()
                if temps:
                    for name, entries in temps.items():
                        for entry in entries:
                            if entry.current and entry.current > 0:
                                return round(float(entry.current), 1)
            except Exception:
                pass

        # 2. Windows WMI MSAcpi_ThermalZoneTemperature (only available when running elevated)
        try:
            import wmi
            w = wmi.WMI(namespace="root\\wmi")
            for temp_obj in w.MSAcpi_ThermalZoneTemperature():
                kelvin_10 = temp_obj.CurrentTemperature
                celsius = (kelvin_10 / 10.0) - 273.15
                if 0 < celsius < 120:
                    return round(celsius, 1)
        except Exception:
            pass

        return None

    def _collect_cpu(self) -> CPUMetrics:
        # Non-blocking delta query since last call
        overall = float(psutil.cpu_percent(interval=None))
        per_core = [float(x) for x in psutil.cpu_percent(percpu=True)]

        freq_mhz: Optional[float] = None
        try:
            cfreq = psutil.cpu_freq()
            if cfreq and cfreq.current:
                freq_mhz = round(float(cfreq.current), 1)
        except Exception:
            pass

        temp_c = self._get_cpu_temperature()

        return CPUMetrics(
            overall_percent=overall,
            per_core_percent=per_core,
            core_count_physical=self._core_physical,
            core_count_logical=self._core_logical,
            frequency_mhz=freq_mhz,
            temperature_c=temp_c
        )

    def _collect_gpu(self) -> GPUMetrics:
        # Re-try init if previously failed
        if not self._nvml_initialized:
            self._init_nvml()

        if self._nvml_initialized and self._nvml_handle:
            try:
                import pynvml
                util_rates = pynvml.nvmlDeviceGetUtilizationRates(self._nvml_handle)
                temp = pynvml.nvmlDeviceGetTemperature(self._nvml_handle, pynvml.NVML_TEMPERATURE_GPU)
                mem_info = pynvml.nvmlDeviceGetMemoryInfo(self._nvml_handle)

                power_watts: Optional[float] = None
                try:
                    power_watts = round(pynvml.nvmlDeviceGetPowerUsage(self._nvml_handle) / 1000.0, 2)
                except Exception:
                    power_watts = None

                vram_pct = round((mem_info.used / mem_info.total) * 100.0, 1) if mem_info.total > 0 else 0.0

                return GPUMetrics(
                    available=True,
                    name=self._gpu_name,
                    utilization_percent=float(util_rates.gpu),
                    temperature_c=float(temp),
                    vram_used_bytes=int(mem_info.used),
                    vram_total_bytes=int(mem_info.total),
                    vram_percent=vram_pct,
                    power_watts=power_watts
                )
            except Exception as e:
                logger.warning(f"NVML read error: {e}. Attempting GPUtil fallback...")
                self._nvml_initialized = False

        # Fallback to GPUtil if NVML read failed
        try:
            import GPUtil
            gpus = GPUtil.getGPUs()
            if gpus:
                g = gpus[0]
                return GPUMetrics(
                    available=True,
                    name=g.name,
                    utilization_percent=round(g.load * 100.0, 1),
                    temperature_c=float(g.temperature) if g.temperature is not None else None,
                    vram_used_bytes=int(g.memoryUsed * (1024 ** 2)),
                    vram_total_bytes=int(g.memoryTotal * (1024 ** 2)),
                    vram_percent=round((g.memoryUsed / g.memoryTotal) * 100.0, 1) if g.memoryTotal > 0 else 0.0,
                    power_watts=None
                )
        except Exception:
            pass

        return GPUMetrics(available=False)

    def _collect_ram(self) -> RAMMetrics:
        vmem = psutil.virtual_memory()
        return RAMMetrics(
            total_bytes=int(vmem.total),
            used_bytes=int(vmem.used),
            available_bytes=int(vmem.available),
            percent=float(vmem.percent)
        )

    def _collect_storage(self) -> List[StorageDrive]:
        drives: List[StorageDrive] = []
        for part in psutil.disk_partitions(all=False):
            if "cdrom" in part.opts or part.fstype == "":
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
                drives.append(StorageDrive(
                    drive=part.device,
                    mount=part.mountpoint,
                    total_bytes=int(usage.total),
                    used_bytes=int(usage.used),
                    free_bytes=int(usage.free),
                    percent=float(usage.percent)
                ))
            except (PermissionError, OSError):
                continue
        return drives

    def _collect_network(self) -> NetworkMetrics:
        now = time.time()
        dt = max(now - self._last_net_time, 0.001)

        try:
            net_io = psutil.net_io_counters()
            now_recv = net_io.bytes_recv
            now_sent = net_io.bytes_sent
        except Exception:
            now_recv = self._last_bytes_recv
            now_sent = self._last_bytes_sent

        down_speed = max(0.0, (now_recv - self._last_bytes_recv) / dt)
        up_speed = max(0.0, (now_sent - self._last_bytes_sent) / dt)

        self._last_net_time = now
        self._last_bytes_recv = now_recv
        self._last_bytes_sent = now_sent

        return NetworkMetrics(
            download_speed_bps=round(down_speed, 1),
            upload_speed_bps=round(up_speed, 1),
            total_bytes_recv=now_recv,
            total_bytes_sent=now_sent
        )

    def _collect_system(self, cpu_avail: bool, gpu_avail: bool) -> SystemMetrics:
        try:
            uptime = max(0.0, time.time() - psutil.boot_time())
        except Exception:
            uptime = 0.0

        return SystemMetrics(
            uptime_seconds=round(uptime, 1),
            host_name=self._host_name,
            cpu_available=cpu_avail,
            gpu_available=gpu_avail,
            status="active"
        )

    def collect(self) -> TelemetryPayload:
        """Gather atomic workstation metrics payload."""
        cpu = self._collect_cpu()
        gpu = self._collect_gpu()
        ram = self._collect_ram()
        storage = self._collect_storage()
        network = self._collect_network()
        system = self._collect_system(
            cpu_avail=True,
            gpu_avail=gpu.available
        )

        return TelemetryPayload(
            timestamp=round(time.time(), 3),
            cpu=cpu,
            gpu=gpu,
            ram=ram,
            storage=storage,
            network=network,
            system=system
        )

