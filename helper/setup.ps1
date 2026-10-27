# One-time setup for the Chord Window YouTube helper on Windows.
# Run in PowerShell:  powershell -ExecutionPolicy Bypass -File setup.ps1 -Site https://your-site.vercel.app
param([Parameter(Mandatory = $true)][string]$Site)
$ErrorActionPreference = "Stop"
$dir = Join-Path $env:LOCALAPPDATA "ChordWindowHelper"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot "helper.mjs") $dir

# Node.js, needed to run the helper and by yt-dlp for YouTube's player.
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
$node = (Get-Command node).Source

# yt-dlp, and cloudflared for the tunnel the site's visitors reach the helper through,
# both refreshed on every run of this script.
Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile (Join-Path $dir "yt-dlp.exe")
Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile (Join-Path $dir "cloudflared.exe")

# A random password shared with the site. Keep the existing one if set up before.
$configPath = Join-Path $dir "config.json"
if (Test-Path $configPath) { $token = (Get-Content $configPath | ConvertFrom-Json).token }
else { $token = -join ((1..40) | ForEach-Object { "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[(Get-Random -Maximum 57)] }) }
# Written without a byte-order mark (Windows PowerShell 5 adds one with -Encoding utf8).
[IO.File]::WriteAllText($configPath, (@{ site = $Site; token = $token } | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

# Start hidden at sign-in, restart if it stops, and keep going on battery.
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$(Join-Path $dir 'helper.mjs')`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "ChordWindowHelper" -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName "ChordWindowHelper"

# Show the password so it can be pasted into Vercel (never sent anywhere else).
$tokenFile = Join-Path $dir "PASTE-INTO-VERCEL.txt"
"HELPER_TOKEN`r`n`r`n$token" | Set-Content -Encoding utf8 $tokenFile
Start-Process notepad.exe $tokenFile
Write-Host "Helper installed and running from $dir"
