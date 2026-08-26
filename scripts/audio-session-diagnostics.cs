using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject { }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDevice device);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, out IntPtr iface);
  int OpenPropertyStore(int stgmAccess, out IntPtr properties);
  int GetId(out IntPtr id);
  int GetState(out int state);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager {
  int GetSimpleAudioVolume(ref Guid sessionGuid, int streamFlags, out ISimpleAudioVolume volume);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume {
  int SetMasterVolume(float level, ref Guid eventContext);
  int GetMasterVolume(out float level);
  int SetMute(bool mute, ref Guid eventContext);
  int GetMute(out bool mute);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  // 必须按 COM vtable 完整顺序定义，否则方法调用会错位崩溃
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(out uint channelCount);
  int SetMasterVolumeLevel(float level, ref Guid eventContext);
  int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetMute(bool mute, ref Guid eventContext);
  int GetMute(out bool mute);
}

/// CoreAudio 自检：报告/修复本进程音频会话音量与静音状态。
public static class AudioSessionDiagnostics {
  static readonly Guid IID_IAudioEndpointVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

  /// 默认输出设备名称（诊断：确认播放器输出路由到哪个设备）。
  public static string DeviceName() {
    try {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      if (enumerator.GetDefaultAudioEndpoint(0, 0, out device) != 0) return "no-default-device";
      IntPtr idPtr;
      if (device.GetId(out idPtr) != 0) return "no-id";
      return Marshal.PtrToStringUni(idPtr);
    } catch (Exception ex) {
      return "ERR:" + ex.Message;
    }
  }

  /// 读取默认输出设备主音量（0-1）与静音。
  public static string DeviceVolume() {
    try {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      if (enumerator.GetDefaultAudioEndpoint(0, 0, out device) != 0) return "no-default-device";
      Guid iid = IID_IAudioEndpointVolume;
      IntPtr epv;
      if (device.Activate(ref iid, 1, IntPtr.Zero, out epv) != 0) return "no-endpoint-volume";
      var vol = (IAudioEndpointVolume)Marshal.GetObjectForIUnknown(epv);
      float level;
      bool mute;
      vol.GetMasterVolumeLevelScalar(out level);
      vol.GetMute(out mute);
      return string.Format("{0:F2} {1}", level, mute ? "MUTED" : "ok");
    } catch (Exception ex) {
      return "ERR:" + ex.Message;
    }
  }

  /// 强制默认输出设备主音量为 1.0 且取消静音（设备级响度保险）。
  public static string DeviceVolumeEnsure() {
    try {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      if (enumerator.GetDefaultAudioEndpoint(0, 0, out device) != 0) return "no-default-device";
      Guid iid = IID_IAudioEndpointVolume;
      IntPtr epv;
      if (device.Activate(ref iid, 1, IntPtr.Zero, out epv) != 0) return "no-endpoint-volume";
      var vol = (IAudioEndpointVolume)Marshal.GetObjectForIUnknown(epv);
      Guid ctx = Guid.Empty;
      bool mute;
      vol.GetMute(out mute);
      if (mute) vol.SetMute(false, ref ctx);
      float level;
      vol.GetMasterVolumeLevelScalar(out level);
      if (level < 0.5f) vol.SetMasterVolumeLevelScalar(1.0f, ref ctx);
      vol.GetMasterVolumeLevelScalar(out level);
      return string.Format("ensured {0:F2} mute={1}", level, mute ? "yes->no" : "no");
    } catch (Exception ex) {
      return "ERR:" + ex.Message;
    }
  }

  static string Probe(bool fix) {
    try {
      var enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
      IMMDevice device;
      if (enumerator.GetDefaultAudioEndpoint(0, 0, out device) != 0) return "no-default-device";
      Guid iidManager = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
      IntPtr mgr;
      if (device.Activate(ref iidManager, 1, IntPtr.Zero, out mgr) != 0) return "no-session-manager";
      var manager = (IAudioSessionManager)Marshal.GetObjectForIUnknown(mgr);
      Guid empty = Guid.Empty;
      ISimpleAudioVolume vol;
      if (manager.GetSimpleAudioVolume(ref empty, 0, out vol) != 0) return "no-session-volume";
      float level;
      bool mute;
      vol.GetMasterVolume(out level);
      vol.GetMute(out mute);
      if (fix && (mute || level <= 0.01f)) {
        Guid ctx = Guid.Empty;
        vol.SetMute(false, ref ctx);
        vol.SetMasterVolume(1.0f, ref ctx);
        return string.Format("FIXED was={0:F2}/{1}", level, mute ? "MUTED" : "ok");
      }
      return string.Format("{0:F2} {1}", level, mute ? "MUTED" : "ok");
    } catch (Exception ex) {
      return "ERR:" + ex.Message;
    }
  }

  public static string SessionVolume() { return Probe(false); }
  public static string SessionVolumeFix() { return Probe(true); }
}