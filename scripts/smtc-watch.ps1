param(
    [string]$AppPattern = 'cloudmusic|netease',
    [int]$IntervalMs = 1000,
    [int]$OwnerProcessId = 0,
    [switch]$Once
)
# Windows PowerShell 5.1 provides the .NET Framework WinRT projection.
$ErrorActionPreference = 'Stop'
$smtcOwner = if ($OwnerProcessId -gt 0) { [System.Diagnostics.Process]::GetProcessById($OwnerProcessId) } else { $null }
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IContentTypeProvider, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
$script:AsTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and
    $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Await-WinRt($Operation, [Type]$ResultType) {
    $task = $script:AsTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    if (-not $task.Wait(5000)) { throw 'SMTC operation timed out' }
    return $task.Result
}
function Write-Frame($Frame) { [Console]::WriteLine(($Frame | ConvertTo-Json -Compress -Depth 6)) }
$manager = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$lastIdentity = ''
$cover = $null
do {
    if ($smtcOwner -and $smtcOwner.HasExited) { break }
    try {
        $sessions = @($manager.GetSessions())
        $matches = @($sessions | Where-Object { $_.SourceAppUserModelId -match $AppPattern })
        $session = $matches | Sort-Object { if ($_.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { 0 } else { 1 } } | Select-Object -First 1
        if (-not $session) {
            $lastIdentity = ''; $cover = $null
            Write-Frame @{ type='smtc'; available=$false; sessions=@($sessions | ForEach-Object { $_.SourceAppUserModelId }) }
        } else {
            $media = Await-WinRt ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $timeline = $session.GetTimelineProperties()
            $status = $session.GetPlaybackInfo().PlaybackStatus.ToString().ToLowerInvariant()
            $source = $session.SourceAppUserModelId
            $identity = "$source`n$($media.Title)`n$($media.Artist)`n$($media.AlbumTitle)"
            if ($identity -ne $lastIdentity) { $cover = $null; $lastIdentity = $identity }
            # Read once per track (retry while the thumbnail is not yet published).
            if (-not $cover -and $media.Thumbnail) {
                $stream = $null; $reader = $null
                try {
                    $stream = Await-WinRt ($media.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                    $streamType = [Windows.Storage.Streams.IRandomAccessStream]
                    $size = $streamType.GetProperty('Size').GetValue($stream, $null)
                    if ($size -gt 0 -and $size -le 2097152) {
                        $inputStream = $streamType.GetMethod('GetInputStreamAt').Invoke($stream, @([uint64]0))
                        $reader = [Windows.Storage.Streams.DataReader]::new($inputStream)
                        $loaded = Await-WinRt ($reader.LoadAsync([uint32]$size)) ([uint32])
                        $bytes = New-Object byte[] $loaded
                        $reader.ReadBytes($bytes)
                        $mime = [Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($stream, $null)
                        $mime = ($mime -split ',')[0].Trim().ToLowerInvariant()
                        if ($mime -match '^image/(png|jpeg|webp|gif)$') {
                            $cover = @{ mime=$mime; data=[Convert]::ToBase64String($bytes) }
                        }
                    }
                } catch { if ($Once) { [Console]::Error.WriteLine(($_ | Out-String)) } } finally {
                    if ($reader) { try { $reader.Dispose() } catch { } }
                    if ($stream -and [System.Runtime.InteropServices.Marshal]::IsComObject($stream)) { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($stream) }
                }
            }
            $duration = [Math]::Max(0, ($timeline.EndTime - $timeline.StartTime).TotalMilliseconds)
            $progress = [Math]::Max(0, ($timeline.Position - $timeline.StartTime).TotalMilliseconds)
            # Some applications update Position sparsely; LastUpdatedTime anchors interpolation.
            if ($status -eq 'playing' -and $timeline.LastUpdatedTime.Year -gt 2000) {
                $elapsed = ([DateTimeOffset]::Now - $timeline.LastUpdatedTime).TotalMilliseconds
                if ($elapsed -gt 0) { $progress += $elapsed }
            }
            if ($duration -gt 0) { $progress = [Math]::Min($progress, $duration) }
            Write-Frame @{ type='smtc'; available=$true; sourceApp=$source; title=$media.Title;
                artist=$media.Artist; album=$media.AlbumTitle; status=$status;
                duration=[long]$duration; progress=[long]$progress; cover=$cover }
        }
    } catch {
        if ($Once) { [Console]::Error.WriteLine(($_ | Out-String)) }
        Write-Frame @{ type='smtc'; available=$false; error='SMTC read failed; retrying' }
    }
    if (-not $Once) { Start-Sleep -Milliseconds ([Math]::Max(500, $IntervalMs)) }
} while (-not $Once)
