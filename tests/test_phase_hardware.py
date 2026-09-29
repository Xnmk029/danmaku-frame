import importlib.util
import json
from pathlib import Path
import threading
import time
import tempfile
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location('hardware', Path(__file__).parents[1] / 'scripts/phase-hardware.py')
hw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hw)


class HardwareTests(unittest.TestCase):
    def test_fancontrol_bridge_expires_and_preserves_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'cpu.json'
            payload = {'ok': True, 'at': 10000, 'source': 'FanControl/IPC', 'cpu': 0, 'cpuKind': 'package'}
            path.write_text(json.dumps(payload), encoding='utf-8')
            self.assertEqual(hw.read_cpu_bridge(path, now=10001)['cpu'], 0)
            payload['source'] = 'FanControl/LibreHardwareMonitor'
            path.write_text(json.dumps(payload), encoding='utf-8')
            self.assertEqual(hw.read_cpu_bridge(path, now=10001)['provider'], 'FanControl/LibreHardwareMonitor')
            self.assertEqual(hw.read_cpu_bridge(path, now=19000), {})
            self.assertEqual(hw.read_cpu_bridge(path, now=1000), {})
            payload.update(ok=False, message='access denied')
            path.write_text(json.dumps(payload), encoding='utf-8')
            self.assertNotIn('cpu', hw.read_cpu_bridge(path, now=10001))
            self.assertEqual(hw.read_cpu_bridge(path, now=10001)['status'], 'fancontrol_unavailable')

    def test_aida64_ansi_and_unicode_package_priority(self):
        fragment = '<temp><id>TGPU1</id><value>85</value></temp><temp><id>TCPU</id><value>40</value></temp><temp><id>TCC-1-1</id><value>74</value></temp><temp><id>TCPUPKG</id><value>62</value></temp>'
        for raw in [fragment.encode() + b'\0', (fragment + '\0').encode('utf-16-le')]:
            self.assertEqual(hw.parse_aida64(raw)['cpu'], 62)
            self.assertEqual(hw.parse_aida64(raw)['cpuKind'], 'package')
        self.assertEqual(hw.parse_aida64(b'<temp><id>TGPU1</id><value>90</value></temp>'), {})
        self.assertEqual(hw.parse_aida64(b'<broken'), {})
        self.assertEqual(hw.parse_aida64(b'<temp><id>TCPUPKG</id><value>999</value></temp>'), {})

    def test_cpu_windows_kernel_includes_idle(self):
        self.assertEqual(hw.cpu_usage((100, 300, 200), (150, 400, 300)), 75)
        self.assertIsNone(hw.cpu_usage(None, (150, 400, 300)))
        self.assertIsNone(hw.cpu_usage((1, 2, 3), (1, 2, 3)))
        self.assertIsNone(hw.number(float('nan')))
        self.assertEqual(hw.number(0), 0)

    def test_temperature_identity_and_package_priority(self):
        data = {'provider': 'root/LibreHardwareMonitor', 'hardware': [
            {'Identifier': 'cpu', 'HardwareType': 'Cpu'},
            {'Identifier': 'ram', 'HardwareType': 'Memory'},
            {'Identifier': 'gpu', 'HardwareType': 'GpuNvidia'},
            {'Identifier': 'board', 'HardwareType': 'Motherboard'},
        ], 'sensors': [
            {'Parent': 'cpu', 'Name': 'CPU Package', 'Value': 62},
            {'Parent': 'cpu', 'Name': 'CPU Core #1', 'Value': 70},
            {'Parent': 'ram', 'Name': 'DIMM', 'Value': 40},
            {'Parent': 'gpu', 'Name': 'GPU Memory', 'Value': 86},
            {'Parent': 'board', 'Name': 'CPU', 'Value': 90},
        ]}
        result = hw.select_temperatures(data)
        self.assertEqual(result['cpu'], 62)
        self.assertEqual(result['memory'], 40)
        data['sensors'] = data['sensors'][1:]
        self.assertEqual(hw.select_temperatures(data)['cpu'], 70)
        data['sensors'] = data['sensors'][2:]
        self.assertIsNone(hw.select_temperatures(data)['cpu'])
        self.assertIsNone(hw.select_temperatures(data)['memory'])

    def test_http_cache_origins_and_stale_health(self):
        class Sampler:
            latest = {'ok': True, 'at': int(time.time() * 1000), 'status': 'connected', 'cpu': {'usage': 42}}
        sampler = Sampler()
        server = hw.ThreadingHTTPServer(('127.0.0.1', 0), hw.handler_for(sampler))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:' + str(server.server_port)
        try:
            with urlopen(Request(url + '/state', headers={'Origin': 'http://localhost:7788'})) as response:
                self.assertEqual(response.headers['Access-Control-Allow-Origin'], 'http://localhost:7788')
                self.assertEqual(json.load(response), sampler.latest)
            with self.assertRaises(HTTPError) as denied:
                urlopen(Request(url + '/state', headers={'Origin': 'https://example.com'}))
            self.assertEqual(denied.exception.code, 403)
            self.assertFalse(hw.local_origin('http://localhost.evil.test'))
            self.assertFalse(hw.local_origin('null'))
            sampler.latest = {**sampler.latest, 'at': 1}
            with self.assertRaises(HTTPError) as stale:
                urlopen(url + '/healthz')
            self.assertEqual(stale.exception.code, 503)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
