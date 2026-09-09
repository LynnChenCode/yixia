#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$InstallRoot = "D:\tools\yixia"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if (-not (Test-Path $RepoRoot)) { $Root = (Get-Location).Path } else { $Root = $RepoRoot }

if (Test-Path (Join-Path $InstallRoot "server\app.py")) {
  $Root = $InstallRoot
}

$ModelDir = if ($env:YIXIA_MODEL_DIR) { $env:YIXIA_MODEL_DIR } else { Join-Path $Root "models\opus" }
$Venv = if ($env:YIXIA_VENV) { $env:YIXIA_VENV } else { Join-Path $Root ".venv" }
$Port = 18790

$env:OMP_NUM_THREADS = "1"
$env:MKL_NUM_THREADS = "1"
$env:OPENBLAS_NUM_THREADS = "1"
$env:YIXIA_THREADS = "1"

if (-not (Test-Path "$Venv\Scripts\python.exe")) {
  $found = $null
  foreach ($name in @("py", "python", "python3")) {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { $found = $cmd; break }
  }
  if (-not $found) { throw "Python not found. Run scripts\setup-windows.ps1 first." }
  if ($found.Name -eq "py.exe" -or $found.Name -eq "py") {
    & $found.Source -3 -m venv $Venv
  } else {
    & $found.Source -m venv $Venv
  }
}
& "$Venv\Scripts\python.exe" -m pip install -q -r (Join-Path $Root "server\requirements.txt")

$env:YIXIA_MODEL_DIR = $ModelDir
$pyDownload = @"
from pathlib import Path
from huggingface_hub import snapshot_download
root = Path(r'$ModelDir')
pairs = {
    'opus-mt-zh-en-ctranslate2': 'gaudi/opus-mt-zh-en-ctranslate2',
    'opus-mt-en-zh-ctranslate2': 'gaudi/opus-mt-en-zh-ctranslate2',
}
patterns = ['model.bin', 'config.json', 'source.spm', 'target.spm', 'shared_vocabulary.json']
for name, repo in pairs.items():
    dest = root / name
    if (dest / 'model.bin').exists():
        continue
    print('Downloading', repo)
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=repo, local_dir=str(dest), allow_patterns=patterns)
"@
& "$Venv\Scripts\python.exe" -c $pyDownload

$env:YIXIA_PORT = "$Port"
Write-Host "YiXia API  http://127.0.0.1:$Port/v1"
Set-Location (Join-Path $Root "server")
& "$Venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port $Port --workers 1
