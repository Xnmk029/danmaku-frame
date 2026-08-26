<#
  tts-player.ps1 — 弹幕朗读常驻播放器（Windows）
  通过 stdin 接收 ASCII 指令：
    PLAY <n>      — 播放 $TTS_AUDIO_DIR\current-<n>.mp3（唯一文件名绕开 MediaPlayer URI 缓存）
    STOP          — 停止当前播放
    VOLUME <v>    — 设置音量 0-1
    SES_FIX       — 强制恢复本进程音频会话音量（音量合成器静音自愈）
    EXIT          — 退出
  启动时输出 SES_VOL <v> <MUTED|ok>（CoreAudio 自检）；播放完成输出 DONE；失败输出 ERROR <message>。
#>
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName PresentationCore | Out-Null

# CoreAudio 会话音量自检（独立 C# 源文件，绕开 here-string 换行兼容问题）
$audioDiagCs = Join-Path $PSScriptRoot 'audio-session-diagnostics.cs'
try {
  Add-Type -Path $audioDiagCs -ErrorAction Stop
} catch {
  Write-Output ("SES_VOL ADDTYPE-ERR " + $_.Exception.Message)
}

$audioDir = $env:TTS_AUDIO_DIR
if (-not $audioDir) { throw 'TTS_AUDIO_DIR not set' }

$volume = 1.0
if ($env:TTS_VOLUME -match '^\d+(\.\d+)?$') {
  $volume = [double]$env:TTS_VOLUME
  if ($volume -lt 0) { $volume = 0 }
  if ($volume -gt 1) { $volume = 1 }
}

$player = New-Object System.Windows.Media.MediaPlayer

function Write-Line([string]$line) {
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

# 报告默认输出设备名称与主音量（诊断/自愈用）
try {
  $deviceName = [AudioSessionDiagnostics]::DeviceName()
} catch {
  $deviceName = "ERR"
}
Write-Line ("DEV_NAME " + $deviceName)
try {
  $sessionInfo = [AudioSessionDiagnostics]::DeviceVolume()
} catch {
  $sessionInfo = "ERR"
}
Write-Line ("DEV_VOL " + $sessionInfo)

Write-Line 'READY'

while ($true) {
  $cmd = [Console]::In.ReadLine()
  if ($null -eq $cmd) { break }
  $cmd = $cmd.Trim()
  if ($cmd -eq 'EXIT') { break }
  if ($cmd -eq 'STOP') {
    try { $player.Stop() } catch {}
    continue
  }
  if ($cmd -like 'VOLUME *') {
    $parsed = [double]($cmd.Substring(7).Trim())
    if ($parsed -ge 0 -and $parsed -le 1) {
      $volume = $parsed
      try { $player.Volume = $volume } catch {}
    }
    continue
  }
  if ($cmd -eq 'SES_FIX') {
    # 强制恢复本进程音频会话音量（音量合成器静音自愈）
    try {
      $fixed = [AudioSessionDiagnostics]::SessionVolumeFix()
      Write-Line ("SES_FIXED " + $fixed)
    } catch {
      Write-Line ('SES_FIXED ERR ' + $_.Exception.Message)
    }
    continue
  }
  if ($cmd -notlike 'PLAY *') { continue }
  $seq = $cmd.Substring(5).Trim()
  if ($seq -notmatch '^\d+$') { continue }
  $audioFile = Join-Path $audioDir ("current-{0}.mp3" -f $seq)

  try {
    # 释放上一条音频文件句柄（否则文件占用清理会失败）
    try { $player.Close() } catch {}

    # 设备级响度保险：默认输出设备音量 <50% 或静音时强制恢复
    try {
      $devNow = [AudioSessionDiagnostics]::DeviceVolume()
      if ($devNow -match 'MUTED|0\.[0-4]') {
        $ensured = [AudioSessionDiagnostics]::DeviceVolumeEnsure()
        Write-Line ("DEV_FIXED " + $ensured)
      }
    } catch { /* 自检失败不影响播放 */ }

    $player.Open([System.Uri]$audioFile)

    # 等待音频元数据就绪（异步加载，上限 8 秒）
    $metaDeadline = (Get-Date).AddSeconds(8)
    while (-not $player.NaturalDuration.HasTimeSpan -and (Get-Date) -lt $metaDeadline) {
      Start-Sleep -Milliseconds 100
    }
    if (-not $player.NaturalDuration.HasTimeSpan) {
      throw 'Audio open failed or format unsupported'
    }

    # 播放前再次确认会话音量非静音（自愈）
    try {
      $volNow = [AudioSessionDiagnostics]::SessionVolume()
      if ($volNow -match 'MUTED|0\.00') {
        [AudioSessionDiagnostics]::SessionVolumeFix() | Out-Null
        Write-Line ("SES_FIXED at-play " + $volNow)
      }
    } catch { /* 自检失败不影响播放 */ }

    $player.Volume = $volume
    $player.Play()

    # 阻塞等待播放结束（上限 180 秒防挂死）
    $playDeadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $playDeadline -and $player.Position -lt $player.NaturalDuration.TimeSpan) {
      Start-Sleep -Milliseconds 120
    }
    # 先释放文件句柄，再通知完成（Media Foundation 底层为异步释放）
    try { $player.Close() } catch {}
    Start-Sleep -Milliseconds 500
    Write-Line 'DONE'
  }
  catch {
    Write-Line ('ERROR ' + $_.Exception.Message)
  }
}