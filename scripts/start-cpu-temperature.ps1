param(
    [string]$FanControlDirectory = 'C:\Users\Administrator\Downloads\FanControl_278_net_10_0',
    [switch]$Elevated,
    [switch]$Replace
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$bridge = Join-Path $projectRoot 'data\hardware\fancontrol-bridge-v2\phase-fancontrol.exe'
$output = Join-Path $projectRoot 'data\hardware\cpu-temperature.json'
if (-not (Test-Path -LiteralPath $bridge)) { throw 'Build the bridge first; see DOCS/phase-hardware.md.' }
if (-not (Test-Path -LiteralPath (Join-Path $FanControlDirectory 'FanControl.IPC.dll'))) { throw 'FanControl IPC library was not found.' }
# Prevent duplicate bridge instances, including an already elevated instance.
$processes = Get-CimInstance Win32_Process -Filter "Name='phase-fancontrol.exe'" -ErrorAction Stop
if ($processes -and -not $Replace) { Write-Output 'CPU temperature bridge is already running.'; exit 0 }
$startOptions = @{ FilePath=$bridge; ArgumentList=@('"' + $FanControlDirectory + '"', '"' + $output + '"'); WorkingDirectory=$projectRoot; WindowStyle='Hidden'; PassThru=$true }
if ($Elevated) { $startOptions.Verb = 'RunAs' }
if ($Replace) { $startOptions.ArgumentList += '--replace' }
$process = Start-Process @startOptions
Write-Output "Read-only FanControl bridge started (PID $($process.Id)); output: $output"
