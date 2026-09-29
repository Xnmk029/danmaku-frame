$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
try {
    $state = Invoke-RestMethod 'http://127.0.0.1:7790/healthz' -TimeoutSec 2
    if ($state.service -eq 'phase-hardware' -and $state.ok) {
        Write-Output 'Hardware sampler is already running: http://127.0.0.1:7790/state'
        exit 0
    }
} catch {}
if (Get-NetTCPConnection -LocalPort 7790 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 7790 is occupied; no existing process was stopped.'
}
$pythonPath = $env:PHASE_TELEMETRY_PYTHON
if (-not $pythonPath) {
    $pythonPath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
}
if (-not (Test-Path -LiteralPath $pythonPath)) { $pythonPath = (Get-Command python -ErrorAction Stop).Source }
$logDir = Join-Path $projectRoot 'data\hardware'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$process = Start-Process -FilePath $pythonPath -ArgumentList 'scripts/phase-hardware.py' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'stdout.log') -RedirectStandardError (Join-Path $logDir 'stderr.log')
for ($attempt = 0; $attempt -lt 12; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $state = Invoke-RestMethod 'http://127.0.0.1:7790/healthz' -TimeoutSec 1
        if ($state.ok -and $state.service -eq 'phase-hardware') {
            Write-Output "Hardware sampler ready (PID $($process.Id)): http://127.0.0.1:7790/state"
            exit 0
        }
    } catch {}
    if ($process.HasExited) { break }
}
throw "Hardware sampler did not become ready; inspect $logDir\stderr.log"
