param([string]$Python = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe")
$project = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $Python)) { throw "Python 不存在：$Python。请使用 -Python 指定可用的 Python 3.12。" }
$target = Join-Path $project 'data\telemetry\deps'
New-Item -ItemType Directory -Force -Path $target | Out-Null
& $Python -m pip install --target $target -r (Join-Path $PSScriptRoot 'phase-telemetry-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw '遥测依赖安装失败' }
Write-Host "采集依赖已安装：$target"
