"""Read-only Windows hardware sampler for PHASE overlays (Python stdlib only).

Usage: python scripts/phase-hardware.py [--once] [--port 7790] [--gpu-index 0]
CPU/RAM: Win32. NVIDIA: NVML. Optional temperatures: running LHM/OHM WMI.
No sensor driver is installed or elevated by this process.
"""
import argparse
import ctypes as C
from ctypes import wintypes as W
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit


def number(value, low=0, high=100):
    try:
        value = float(value)
        return round(value, 1) if math.isfinite(value) and low <= value <= high else None
    except (TypeError, ValueError):
        return None


def cpu_usage(previous, current):
    if previous is None:
        return None
    idle, kernel, user = (b - a for a, b in zip(previous, current))
    total = kernel + user  # Windows kernel time includes idle time.
    return number(100 * (total - idle) / total) if total > 0 and idle >= 0 else None


class MemoryStatus(C.Structure):
    _fields_ = [('length', W.DWORD), ('load', W.DWORD)] + [
        (name, C.c_ulonglong) for name in
        ('total', 'available', 'pageTotal', 'pageAvailable', 'virtualTotal', 'virtualAvailable', 'extended')]


class Win32:
    def __init__(self):
        self.dll = C.WinDLL('kernel32', use_last_error=True)
        self.dll.GetSystemTimes.argtypes = [C.POINTER(W.FILETIME)] * 3
        self.dll.GetSystemTimes.restype = W.BOOL
        self.dll.GlobalMemoryStatusEx.argtypes = [C.POINTER(MemoryStatus)]
        self.dll.GlobalMemoryStatusEx.restype = W.BOOL
        self.previous = None

    def sample(self):
        cpu = {'usage': None, 'temperature': None, 'source': 'Win32/GetSystemTimes'}
        memory = {'usage': None, 'temperature': None, 'source': 'Win32/GlobalMemoryStatusEx'}
        times = [W.FILETIME() for _ in range(3)]
        if self.dll.GetSystemTimes(*(C.byref(t) for t in times)):
            current = tuple((t.dwHighDateTime << 32) | t.dwLowDateTime for t in times)
            cpu['usage'] = cpu_usage(self.previous, current)
            self.previous = current
        mem = MemoryStatus()
        mem.length = C.sizeof(mem)
        if self.dll.GlobalMemoryStatusEx(C.byref(mem)) and mem.total:
            memory.update(usage=number(100 * (mem.total - mem.available) / mem.total),
                          totalGiB=round(mem.total / 2**30, 2),
                          availableGB=round(mem.available / 1_000_000_000, 2),
                          usedGiB=round((mem.total - mem.available) / 2**30, 2))
        return cpu, memory


class Utilization(C.Structure):
    _fields_ = [('gpu', C.c_uint), ('memory', C.c_uint)]


class Nvidia:
    def __init__(self, index=0):
        self.index, self.dll, self.retry = index, None, 0

    def connect(self):
        # Absolute NVIDIA driver path, never load a DLL from the working directory.
        path = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/nvml.dll'
        dll = C.CDLL(str(path))
        dll.nvmlInit_v2.restype = C.c_int
        dll.nvmlDeviceGetHandleByIndex_v2.argtypes = [C.c_uint, C.POINTER(C.c_void_p)]
        dll.nvmlDeviceGetName.argtypes = [C.c_void_p, C.c_char_p, C.c_uint]
        dll.nvmlDeviceGetUtilizationRates.argtypes = [C.c_void_p, C.POINTER(Utilization)]
        dll.nvmlDeviceGetTemperature.argtypes = [C.c_void_p, C.c_uint, C.POINTER(C.c_uint)]
        if dll.nvmlInit_v2() != 0:
            raise OSError('NVML unavailable')
        self.handle = C.c_void_p()
        if dll.nvmlDeviceGetHandleByIndex_v2(self.index, C.byref(self.handle)) != 0:
            dll.nvmlShutdown()
            raise OSError('GPU index unavailable')
        name = C.create_string_buffer(128)
        self.name = name.value.decode('utf-8', 'replace') if dll.nvmlDeviceGetName(self.handle, name, len(name)) == 0 else 'NVIDIA GPU'
        self.dll = dll

    def sample(self):
        result = {'usage': None, 'temperature': None, 'name': None, 'source': 'NVIDIA/NVML', 'index': self.index}
        if self.dll is None and time.monotonic() >= self.retry:
            self.retry = time.monotonic() + 30
            try:
                self.connect()
            except (OSError, AttributeError):
                pass
        if self.dll:
            result['name'] = self.name
            util, temp = Utilization(), C.c_uint()
            usage_code = self.dll.nvmlDeviceGetUtilizationRates(self.handle, C.byref(util))
            temp_code = self.dll.nvmlDeviceGetTemperature(self.handle, 0, C.byref(temp))
            if usage_code == 0:
                result['usage'] = number(util.gpu)
            if temp_code == 0:
                result['temperature'] = number(temp.value, 0, 150)
            if usage_code not in (0, 3) and temp_code not in (0, 3):
                self.close()  # Retry after driver reset / sleep, without retaining stale values.
        return result

    def close(self):
        if self.dll:
            self.dll.nvmlShutdown()
            self.dll = None


# Query only the sensor providers, not ACPI thermal zones (not CPU temperatures).
WMI_QUERY = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
foreach ($ns in @('root/LibreHardwareMonitor', 'root/OpenHardwareMonitor')) {
  try {
    $hardware = @(Get-CimInstance -Namespace $ns -ClassName Hardware | Select-Object Identifier,Parent,HardwareType,Name)
    $sensors = @(Get-CimInstance -Namespace $ns -ClassName Sensor -Filter "SensorType='Temperature'" | Select-Object Parent,Name,Value)
    @{provider=$ns;hardware=$hardware;sensors=$sensors} | ConvertTo-Json -Depth 5 -Compress
    exit 0
  } catch {}
}
'{}'
"""


def select_temperatures(data):
    hardware = {h.get('Identifier'): h for h in data.get('hardware', [])}
    cpu_package, cpu_core, memory = [], [], []
    for sensor in data.get('sensors', []):
        value = number(sensor.get('Value'), 0, 150)
        if value is None:
            continue
        parent, kinds = sensor.get('Parent'), set()
        visited = set()
        while parent in hardware and parent not in visited:
            visited.add(parent)
            item = hardware[parent]
            kinds.add(str(item.get('HardwareType', '')).lower())
            parent = item.get('Parent')
        name = str(sensor.get('Name', '')).lower()
        if 'distance' in name or 'tjmax' in name:
            continue  # A distance to a thermal limit is not an actual temperature.
        if 'cpu' in kinds:
            if 'package' in name or 'tctl/tdie' in name or name == 'cpu die (average)':
                cpu_package.append(value)
            elif 'core' in name:
                cpu_core.append(value)
        elif kinds & {'ram', 'memory'}:
            memory.append(value)
    cpu = cpu_package or cpu_core
    return {'cpu': max(cpu) if cpu else None, 'memory': max(memory) if memory else None,
            'cpuKind': 'package' if cpu_package else 'core-max' if cpu_core else None,
            'provider': data.get('provider')}


def read_cpu_bridge(path, now=None):
    try:
        data = json.loads(path.read_text(encoding='utf-8-sig'))
        age = (time.time() * 1000 if now is None else now) - float(data.get('at', 0))
        if not -2000 <= age < 8000 or data.get('source') not in ('FanControl/IPC', 'FanControl/LibreHardwareMonitor'):
            return {}
        if not data.get('ok'):
            return {'status': 'fancontrol_unavailable', 'message': str(data.get('message', ''))[:240]}
        cpu = number(data.get('cpu'), 0, 150)
        return {'cpu': cpu, 'cpuKind': data.get('cpuKind'), 'provider': data['source'], 'status': 'connected'} if cpu is not None else {}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def parse_aida64(raw):
    # v7.99+ uses UTF-16LE; older releases publish a null-terminated ANSI fragment.
    if len(raw) > 1 and raw[1] == 0:
        text = raw[:len(raw) // 2 * 2].decode('utf-16-le', 'replace').split('\0', 1)[0]
    else:
        text = raw.split(b'\0', 1)[0].decode('utf-8', 'replace')
    try:
        root = ET.fromstring('<root>' + text + '</root>')
    except ET.ParseError:
        return {}
    readings = {item.findtext('id', '').upper(): number(item.findtext('value'), 0, 150) for item in root.findall('temp')}
    packages = [readings.get(key) for key in ('TCPUPKG', 'TCPU1PKG', 'TCPUTCTL', 'TCPUDIO')]
    selected = next((v for v in packages if v is not None), None)
    kind = 'package'
    if selected is None:
        cores = [value for key, value in readings.items() if re.fullmatch(r'TCC-1-\d+', key) and value is not None]
        selected, kind = (max(cores), 'core-max') if cores else (readings.get('TCPU'), 'cpu-sensor')
    return {'cpu': selected, 'cpuKind': kind, 'provider': 'AIDA64/shared-memory', 'status': 'connected'} if selected is not None else {}


def read_aida64():
    """Open only an existing read-only mapping; never create or change AIDA64."""
    if os.name != 'nt':
        return {}
    dll = C.WinDLL('kernel32', use_last_error=True)
    dll.OpenFileMappingW.argtypes, dll.OpenFileMappingW.restype = [W.DWORD, W.BOOL, W.LPCWSTR], W.HANDLE
    dll.MapViewOfFile.argtypes, dll.MapViewOfFile.restype = [W.HANDLE, W.DWORD, W.DWORD, W.DWORD, C.c_size_t], C.c_void_p
    dll.UnmapViewOfFile.argtypes = [C.c_void_p]
    dll.CloseHandle.argtypes = [W.HANDLE]
    # AIDA64 supports both session-local and Global mappings.
    for name in ('AIDA64_SensorValues', 'Global\\AIDA64_SensorValues'):
        handle = dll.OpenFileMappingW(4, False, name)
        if not handle:
            continue
        view = None
        try:
            # Official external application buffer is >=10 KB; mapping an exact
            # 10 KB view avoids reading beyond the producer's mapped buffer.
            view = dll.MapViewOfFile(handle, 4, 0, 0, 10240)
            if view:
                return parse_aida64(C.string_at(view, 10240))
        finally:
            if view:
                dll.UnmapViewOfFile(view)
            dll.CloseHandle(handle)
    return {}


class Temperatures:
    def __init__(self, stop):
        self.stop = stop
        self.latest = {}

    def bridge(self):
        return read_cpu_bridge(Path(__file__).resolve().parents[1] / 'data/hardware/cpu-temperature.json')

    def run(self):
        shell = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        next_wmi, wmi = 0, {}
        while not self.stop.is_set():
            bridge = self.bridge()
            live = bridge if bridge.get('cpu') is not None else read_aida64()
            if live.get('cpu') is not None:
                self.latest = {**live, 'at': time.monotonic()}
                self.stop.wait(2)
                continue
            if time.monotonic() >= next_wmi:
                try:
                    proc = subprocess.run([str(shell), '-NoProfile', '-NonInteractive', '-Command', WMI_QUERY],
                                          capture_output=True, timeout=8, creationflags=subprocess.CREATE_NO_WINDOW)
                    data = json.loads(proc.stdout.decode('utf-8-sig')) if proc.returncode == 0 else {}
                    wmi = {**select_temperatures(data), 'at': time.monotonic()}
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    wmi = {}
                next_wmi = time.monotonic() + (10 if wmi.get('provider') else 30)
            self.latest = wmi if wmi.get('cpu') is not None and time.monotonic() - wmi.get('at', 0) < 25 else {**bridge, 'at': time.monotonic()}
            self.stop.wait(2)

    def read(self):
        latest = self.latest
        return latest if time.monotonic() - latest.get('at', 0) < 25 else {}


class Sampler:
    def __init__(self, gpu_index=0):
        self.stop = threading.Event()
        self.win, self.gpu = Win32(), Nvidia(gpu_index)
        self.temperatures = Temperatures(self.stop)
        self.latest = {'ok': True, 'status': 'starting', 'at': 0}

    def sample(self):
        cpu, memory = self.win.sample()
        temperatures = self.temperatures.read()
        cpu.update(temperature=temperatures.get('cpu'), temperatureSource=temperatures.get('provider'),
                   temperatureKind=temperatures.get('cpuKind'))
        cpu.update(temperatureStatus=temperatures.get('status'), temperatureMessage=temperatures.get('message'))
        memory.update(temperature=temperatures.get('memory'), temperatureSource=temperatures.get('provider') if temperatures.get('memory') is not None else None)
        self.latest = {'ok': True, 'status': 'connected', 'at': int(time.time() * 1000),
                       'cpu': cpu, 'memory': memory, 'gpu': self.gpu.sample(),
                       'temperatureProvider': temperatures.get('provider')}
        return self.latest

    def run(self):
        threading.Thread(target=self.temperatures.run, daemon=True, name='hardware-temperatures').start()
        self.sample()
        while not self.stop.wait(2):
            try:
                self.sample()
            except Exception:
                # Preserve old timestamp on unexpected errors; readers expire the data.
                continue


def local_origin(origin):
    try:
        parsed = urlsplit(origin)
        return (parsed.scheme in ('http', 'https') and parsed.hostname in ('127.0.0.1', 'localhost', '::1')
                and not parsed.username and not parsed.password)
    except ValueError:
        return False


def handler_for(sampler):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '').split(':')[0].lower()
            if host not in ('127.0.0.1', 'localhost') or (origin and not local_origin(origin)):
                self.send_error(403)
                return
            route = urlsplit(self.path).path
            if route not in ('/state', '/healthz'):
                self.send_error(404)
                return
            state = sampler.latest
            if route == '/healthz':
                fresh = time.time() * 1000 - state['at'] < 8000
                state = {'ok': fresh, 'service': 'phase-hardware', 'status': state['status'] if fresh else 'stale'}
            payload = json.dumps(state, ensure_ascii=False, allow_nan=False).encode('utf-8')
            self.send_response(200 if route == '/state' or state['ok'] else 503)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            if origin:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--port', type=int, default=7790)
    parser.add_argument('--gpu-index', type=int, default=0)
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('This sampler requires Windows')
    sampler = Sampler(args.gpu_index)
    if args.once:
        sampler.sample()
        time.sleep(1)
        print(json.dumps(sampler.sample(), ensure_ascii=False))
        sampler.gpu.close()
        return
    # Bind before starting workers so duplicate launches have no side effects.
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(sampler))
    threading.Thread(target=sampler.run, daemon=True, name='hardware-sampler').start()
    print(f'PHASE hardware listening at http://127.0.0.1:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        sampler.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
