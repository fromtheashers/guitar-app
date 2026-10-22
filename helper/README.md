# YouTube helper

Runs on a home computer so YouTube downloads come from a home connection, which YouTube doesn't block. It polls the site for work; no tunnel or router changes are needed. Audio stays in memory and is never saved.

**Windows setup:** run `setup.ps1 -Site https://your-site.onrender.com` in PowerShell. It installs Node (if missing) and yt-dlp into `%LOCALAPPDATA%\ChordWindowHelper`, creates a password, registers a task that starts the helper at sign-in, and opens `PASTE-INTO-RENDER.txt`. Add that value as `HELPER_TOKEN` in Render's environment settings.

Re-run the script now and then to update yt-dlp when YouTube changes something.
