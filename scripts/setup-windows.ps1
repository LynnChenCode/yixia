#Requires -Version 5.1
# Install YiXia to D:\tools\yixia (OPUS-MT zh<->en).
#
#   cd <project-root>
#   $env:YIXIA_PYTHON = "py -3.14"   # optional override
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
$ErrorActionPreference = "Stop"

$InstallRoot = "D:\tools\yixia"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
if (-not (Test-Path (Join-Path $RepoRoot "server\app.py"))) {
  throw "Run this from the YiXia project folder (server\app.py not found)."
}

function Invoke-PythonPrint {
  param(
    [string]$Launcher,   # e.g. py
    [string[]]$LauncherArgs, # e.g. -3.14
    [string]$PyCode
  )
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "SilentlyContinue"
  try {
    # Write code to a temp file so cmd/PowerShell never mangle % or quotes.
    $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("yixia-probe-" + [guid]::NewGuid().ToString("n") + ".py"))
    [System.IO.File]::WriteAllText($tmp, $PyCode + "`n", (New-Object System.Text.UTF8Encoding $false))
    try {
      $allArgs = @()
      if ($LauncherArgs) { $allArgs += $LauncherArgs }
      $allArgs += $tmp
      $output = & $Launcher @allArgs 2>$null
      return @($output | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
    } finally {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Test-VersionOk {
  param([string]$VersionText)
  if (-not $VersionText) { return $false }
  if ($VersionText -match '^(\d+)\.(\d+)$') {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    return (($major -gt 3) -or (($major -eq 3) -and ($minor -ge 10)))
  }
  return $false
}

function Resolve-PythonFromSpec {
  param([string]$Spec)
  # Spec examples: "py -3.14", "python", "C:\Path\python.exe"
  $parts = $Spec.Trim() -split '\s+', 2
  $launcher = $parts[0]
  $launcherArgs = @()
  if ($parts.Count -gt 1 -and $parts[1].Trim().Length -gt 0) {
    $launcherArgs = $parts[1].Trim() -split '\s+'
  }

  if ($launcher -match '\.exe$' -or (Test-Path -LiteralPath $launcher)) {
    $exePath = $launcher
    $verLines = Invoke-PythonPrint -Launcher $exePath -LauncherArgs @() -PyCode "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]))"
    $ver = $verLines | Select-Object -Last 1
    if (Test-VersionOk $ver) {
      return @{ Exe = $exePath; Version = $ver }
    }
    return $null
  }

  $verLines = Invoke-PythonPrint -Launcher $launcher -LauncherArgs $launcherArgs -PyCode "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]))"
  $ver = $verLines | Select-Object -Last 1
  if (-not (Test-VersionOk $ver)) { return $null }

  $exeLines = Invoke-PythonPrint -Launcher $launcher -LauncherArgs $launcherArgs -PyCode "import sys; print(sys.executable)"
  $exe = $exeLines | Select-Object -Last 1
  if (-not $exe) { return $null }
  return @{ Exe = $exe; Version = $ver }
}

function Find-Python {
  $specs = @()
  if ($env:YIXIA_PYTHON) { $specs += $env:YIXIA_PYTHON.Trim() }
  $specs += @(
    "py -3.14",
    "py -3.13",
    "py -3.12",
    "py -3.11",
    "py -3.10",
    "python3.14",
    "python3.13",
    "python3.12",
    "python3.11",
    "python3.10",
    "py -3",
    "python3",
    "python"
  )

  foreach ($spec in $specs) {
    $found = Resolve-PythonFromSpec -Spec $spec
    if ($null -eq $found) { continue }
    Write-Host ("Using: {0} ({1}) -> {2}" -f $spec, $found.Version, $found.Exe)
    return @{ Exe = $found.Exe; Prefix = @() }
  }

  throw @"
Python 3.10+ was not found.

If py -3.14 --version works, run:
  `$env:YIXIA_PYTHON = "py -3.14"
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
"@
}

Write-Host "Creating $InstallRoot ..."
New-Item -ItemType Directory -Force -Path $InstallRoot, (Join-Path $InstallRoot "models\opus") | Out-Null

$repoResolved = (Resolve-Path $RepoRoot).Path.TrimEnd("\")
$installResolved = (Resolve-Path $InstallRoot).Path.TrimEnd("\")
if ($repoResolved -ne $installResolved) {
  Write-Host "Copying files to $InstallRoot"
  $copyNames = @(
    "server", "scripts", "app", "components", "lib",
    "package.json", "package-lock.json", "next.config.ts",
    "tsconfig.json", "postcss.config.mjs", "components.json",
    "eslint.config.mjs", "README.md"
  )
  foreach ($name in $copyNames) {
    $src = Join-Path $RepoRoot $name
    if (-not (Test-Path $src)) { continue }
    $dest = Join-Path $InstallRoot $name
    if (Test-Path $src -PathType Container) {
      if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
      Copy-Item -Recurse -Force $src $dest
    } else {
      Copy-Item -Force $src $dest
    }
  }
}

$Py = Find-Python
$Venv = Join-Path $InstallRoot ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$needVenv = $true
if (Test-Path $VenvPy) {
  $verLines = Invoke-PythonPrint -Launcher $VenvPy -LauncherArgs @() -PyCode "import sys; print(str(sys.version_info[0]) + '.' + str(sys.version_info[1]))"
  $ver = $verLines | Select-Object -Last 1
  if (Test-VersionOk $ver) { $needVenv = $false }
}
if ($needVenv) {
  if (Test-Path $Venv) {
    Write-Host "Recreating venv with a newer Python..."
    Remove-Item -Recurse -Force $Venv
  } else {
    Write-Host "Creating venv..."
  }
  & $Py.Exe @("-m", "venv", $Venv)
  if (-not (Test-Path $VenvPy)) {
    throw "venv was not created at $VenvPy"
  }
}

Write-Host "Installing Python packages (CTranslate2 / FastAPI)..."
& $VenvPy -m pip install -U pip
& $VenvPy -m pip install -r (Join-Path $InstallRoot "server\requirements.txt")

$ModelDir = Join-Path $InstallRoot "models\opus"
$env:YIXIA_MODEL_DIR = $ModelDir
Write-Host "Downloading zh-en models (~155 MB each, disk only)..."
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
        print('already have', dest)
        continue
    print('Downloading', repo)
    dest.mkdir(parents=True, exist_ok=True)
    snapshot_download(repo_id=repo, local_dir=str(dest), allow_patterns=patterns)
print('models ready')
"@
& $VenvPy -c $pyDownload

$StartPs1 = Join-Path $InstallRoot "start-yixia.ps1"
$startPs1Body = @"
#Requires -Version 5.1
`$ErrorActionPreference = "Stop"
`$env:YIXIA_MODEL_DIR = "D:\tools\yixia\models\opus"
`$env:YIXIA_VENV = "D:\tools\yixia\.venv"
Set-Location "D:\tools\yixia"
& "D:\tools\yixia\scripts\start-api.ps1"
"@
[System.IO.File]::WriteAllText($StartPs1, $startPs1Body, (New-Object System.Text.UTF8Encoding $false))

$StartCmd = Join-Path $InstallRoot "start-yixia.cmd"
$startCmdBody = "@echo off`r`ncd /d D:\tools\yixia`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"D:\tools\yixia\start-yixia.ps1`"`r`n"
[System.IO.File]::WriteAllText($StartCmd, $startCmdBody, (New-Object System.Text.ASCIIEncoding))

$Hint = Join-Path $InstallRoot "plugin-settings.txt"
$hintBody = @"
YiXia installed at D:\tools\yixia

Double-click start-yixia.cmd to run. RAM ~400 MB.

Immersive Translate / other plugins:
  Type      OpenAI compatible
  Base URL  http://127.0.0.1:18790/v1
  Model     yixia
  API Key   local (any value)
  Target    Chinese or English only

Optional web UI:
  cd /d D:\tools\yixia
  npm install
  npm run dev
"@
[System.IO.File]::WriteAllText($Hint, $hintBody, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Installed to $InstallRoot"
Write-Host "Start: double-click D:\tools\yixia\start-yixia.cmd"
Write-Host "API:   http://127.0.0.1:18790/v1   model: yixia"
Write-Host "See:   D:\tools\yixia\plugin-settings.txt"
