#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$env:YIXIA_MODEL_DIR = "D:\tools\yixia\models\opus"
$env:YIXIA_VENV = "D:\tools\yixia\.venv"
Set-Location "D:\tools\yixia"
& "D:\tools\yixia\scripts\start-api.ps1"