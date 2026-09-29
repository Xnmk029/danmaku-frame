"""PHASE local telemetry worker. Emits newline-delimited JSON; never sends raw audio."""
import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'data' / 'telemetry' / 'deps'))


def emit(kind, **fields):
    try:
        print(json.dumps({'type': kind, **fields}, ensure_ascii=False), flush=True)
    except (BrokenPipeError, OSError):
        os._exit(0)


async def scan():
    from bleak import BleakScanner
    found = await BleakScanner.discover(timeout=7, return_adv=True)
    devices = []
    for device, adv in found.values():
        name = adv.local_name or device.name or ''
        heart = any('180d' in str(uuid).lower() for uuid in adv.service_uuids)
        if name or heart:
            devices.append({'name': name, 'address': device.address,
                            'rssi': adv.rssi, 'heartService': heart})
    emit('telemetry.scan', devices=sorted(devices, key=lambda x: (not x['heartService'], -x['rssi'])))


async def heart(address):
    from bleak import BleakClient, BleakScanner
    heart_uuid = '00002a37-0000-1000-8000-00805f9b34fb'
    while True:
        try:
            emit('heart.status', status='scanning')
            devices = await BleakScanner.discover(timeout=7, return_adv=True)
            match = next((device for device, adv in devices.values()
                          if address.lower() == device.address.lower()
                          or (address.lower() in (adv.local_name or device.name or '').lower()
                              and (adv.local_name or device.name))), None)
            if match is None:
                emit('heart.status', status='not_found')
                await asyncio.sleep(5)
                continue
            async with BleakClient(match, timeout=15) as client:
                emit('heart.status', status='connected', name=match.name or address)
                def on_heart(_sender, data):
                    if len(data) < 2:
                        return
                    bpm = int.from_bytes(data[1:3], 'little') if data[0] & 1 else data[1]
                    if 25 <= bpm <= 240:
                        emit('heart.rate', bpm=bpm, at=int(time.time() * 1000))
                await client.start_notify(heart_uuid, on_heart)
                while client.is_connected:
                    await asyncio.sleep(1)
            emit('heart.status', status='disconnected')
        except Exception as exc:
            emit('heart.status', status='error', message=str(exc)[:160])
        await asyncio.sleep(5)


def audio():
    import numpy as np
    import soundcard as sc
    edges = np.geomspace(35, 10000, 25)
    while True:
        try:
            speaker = sc.default_speaker()
            if speaker is None:
                raise RuntimeError('没有默认播放设备')
            loop = sc.get_microphone(id=speaker.id, include_loopback=True)
            emit('audio.status', status='connected', name=speaker.name)
            with loop.recorder(samplerate=22050, channels=1, blocksize=1024) as recorder:
                while True:
                    current = sc.default_speaker()
                    if current is None or current.id != speaker.id:
                        break
                    samples = np.asarray(recorder.record(numframes=1024), dtype=np.float64).reshape(-1)
                    if len(samples) != 1024:
                        continue
                    spectrum = np.abs(np.fft.rfft(samples * np.hanning(len(samples)))) / len(samples)
                    freqs = np.fft.rfftfreq(len(samples), 1 / 22050)
                    bars = []
                    for low, high in zip(edges[:-1], edges[1:]):
                        band = spectrum[(freqs >= low) & (freqs < high)]
                        peak = float(band.max()) if len(band) else 0.0
                        bars.append(round(float(np.clip((20 * np.log10(max(peak, 1e-8)) + 72) / 54, 0, 1)), 3))
                    emit('audio.spectrum', bands=bars, at=int(time.time() * 1000))
            emit('audio.status', status='device_changed')
        except Exception as exc:
            emit('audio.status', status='error', message=str(exc)[:160])
        time.sleep(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['scan', 'heart', 'audio'])
    parser.add_argument('--device', default='instinct')
    args = parser.parse_args()
    try:
        if args.mode == 'scan':
            asyncio.run(scan())
        elif args.mode == 'heart':
            asyncio.run(heart(args.device))
        else:
            audio()
    except Exception as exc:
        emit('telemetry.error', message=str(exc)[:160])
        sys.exit(1)
