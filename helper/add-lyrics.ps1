# Adds lyric matching to the Chord Window helper: copies the new helper.mjs and
# separate.py into place, installs Whisper into the Python that separates songs,
# downloads its two speech models once (about 2 GB), and restarts the helper.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File add-lyrics.ps1
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "ChordWindowHelper"
if (-not (Test-Path (Join-Path $dir "helper.mjs"))) { throw "The helper isn't installed in $dir. Run setup.ps1 first." }

# Same settings the helper reads: separator.json, then config.json on top (the password is skipped).
$settings = @{}
foreach ($name in "separator.json", "config.json") {
  $file = Join-Path $dir $name
  if (Test-Path $file) {
    $json = ((Get-Content -Raw $file) -replace "^﻿", "") | ConvertFrom-Json
    foreach ($p in $json.PSObject.Properties) { if ($p.Name -ne "token") { $settings[$p.Name] = $p.Value } }
  }
}
$python = $settings["separator"]
if (-not $python) { throw "Song separation isn't set up on this computer (no ""separator"" in separator.json), and lyric matching needs it." }
$script = if ($settings["separatorScript"]) { $settings["separatorScript"] } else { Join-Path $dir "separate.py" }
$models = if ($settings["models"]) { $settings["models"] } else { [IO.Path]::GetFullPath((Join-Path (Split-Path $python) "..\..\models")) }

Write-Host "Stopping the helper..."
Stop-ScheduledTask -TaskName "ChordWindowHelper" -ErrorAction SilentlyContinue

Write-Host "Copying the new helper files..."
Copy-Item -Force (Join-Path $PSScriptRoot "helper.mjs") (Join-Path $dir "helper.mjs")
Copy-Item -Force (Join-Path $PSScriptRoot "separate.py") $script

Write-Host "Installing Whisper into $python ..."
& $python -m pip install --upgrade openai-whisper
if ($LASTEXITCODE -ne 0) { throw "pip couldn't install openai-whisper (see the messages above)." }

$whisperDir = Join-Path $models "whisper"
Write-Host "Downloading the speech models into $whisperDir (once, about 2 GB)..."
& $python -c "import sys, whisper; [whisper.load_model(m, device='cpu', download_root=sys.argv[1]) for m in ('turbo', 'small')]; print('Speech models ready.')" $whisperDir
if ($LASTEXITCODE -ne 0) { throw "The speech models didn't download (see the messages above). Run this script again to retry." }

Write-Host "Starting the helper again..."
Start-ScheduledTask -TaskName "ChordWindowHelper"
Write-Host "Done. Lyric matching is ready."
