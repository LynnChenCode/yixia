#Requires -Version 5.1
$ErrorActionPreference = "Stop"
$root = if ($env:LLAMA_HOME) { $env:LLAMA_HOME } else { "D:\tools\llama" }
$exe = Get-ChildItem $root -Recurse -Filter llama-server.exe | Select-Object -First 1
if (-not $exe) { throw "llama-server.exe not found under $root. Run scripts/setup-windows.ps1 first." }
$model = Join-Path $root "models\Hy-MT2-1.8B-Q4_K_M.gguf"
if (-not (Test-Path $model)) { throw "Missing $model" }
Write-Host "Hy-MT2 listening on http://127.0.0.1:18791"
& $exe.FullName --model $model --host 127.0.0.1 --port 18791 --jinja -ngl 0 -c 2048 --parallel 1 --temp 0.7 --top-p 0.6 --top-k 20 --repeat-penalty 1.05 --alias Hy-MT2-1.8B
