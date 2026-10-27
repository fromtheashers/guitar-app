# Updates the Chord Window helper for the site on Vercel (helper version 4): copies
# the new helper.mjs into place, downloads cloudflared (the free tunnel browsers reach
# the helper through) and a fresh yt-dlp, points the helper at the new site, and
# restarts it. Keeps the existing password and separation settings.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File move-to-vercel.ps1 -Site https://your-site.vercel.app
param([Parameter(Mandatory = $true)][string]$Site)
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "ChordWindowHelper"
$configPath = Join-Path $dir "config.json"
if (-not (Test-Path $configPath)) { throw "The helper isn't installed in $dir. Run setup.ps1 instead." }

Write-Host "Stopping the helper..."
Stop-ScheduledTask -TaskName "ChordWindowHelper" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe' or Name = 'cloudflared.exe'" |
  Where-Object { $_.CommandLine -like "*ChordWindowHelper*" -or $_.CommandLine -like "*127.0.0.1:47321*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host "Copying the new helper..."
Copy-Item -Force (Join-Path $PSScriptRoot "helper.mjs") (Join-Path $dir "helper.mjs")

Write-Host "Downloading cloudflared and the latest yt-dlp..."
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile (Join-Path $dir "cloudflared.exe")
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $dir "yt-dlp.exe")

# Point at the new site, keeping the password and anything else in config.json.
$config = ((Get-Content -Raw $configPath) -replace "^﻿", "") | ConvertFrom-Json
$config | Add-Member -NotePropertyName site -NotePropertyValue $Site.TrimEnd("/") -Force
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Write-Host "Starting the helper again..."
Start-ScheduledTask -TaskName "ChordWindowHelper"

# The password, for HELPER_TOKEN in Vercel (never sent anywhere else).
$tokenFile = Join-Path $dir "PASTE-INTO-VERCEL.txt"
"HELPER_TOKEN`r`n`r`n$($config.token)" | Set-Content -Encoding utf8 $tokenFile
Start-Process notepad.exe $tokenFile
Write-Host "Done. The helper now serves $Site through a Cloudflare tunnel."
