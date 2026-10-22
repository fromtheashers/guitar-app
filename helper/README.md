# YouTube helper

Runs on a home computer so YouTube downloads come from a home connection, which YouTube doesn't block. It polls the site for work; no tunnel or router changes are needed. Audio stays in memory and is never saved.

**Windows setup:** run `setup.ps1 -Site https://your-site.onrender.com` in PowerShell. It installs Node (if missing) and yt-dlp into `%LOCALAPPDATA%\ChordWindowHelper`, creates a password, registers a task that starts the helper at sign-in, and opens `PASTE-INTO-RENDER.txt`. Add that value as `HELPER_TOKEN` in Render's environment settings.

Re-run the script now and then to update yt-dlp when YouTube changes something.

## Optional: vocal and drum separation

With separation set up, the helper splits each song with Demucs before sending it: the site then reads chords from the instruments alone and strum patterns from the drums alone. It runs only while a song is being drafted.

1. Make a Python 3.12 environment outside AppData (for example `C:\ChordWindow\sep\venv`) and install `torch`, `torchaudio` (the CUDA build if the computer has an NVIDIA card), `demucs` and `soundfile`.
2. Put ffmpeg where the helper can find it: `ffmpeg.exe` next to `helper.mjs`, on PATH, or `"ffmpeg"` in `separator.json`.
3. Next to `helper.mjs`, create `separator.json` (no password goes in it):
   `{"separator": "C:\\ChordWindow\\sep\\venv\\Scripts\\python.exe", "separatorScript": "C:\\ChordWindow\\sep\\separate.py", "models": "C:\\ChordWindow\\sep\\models"}`
4. Restart the helper. Its window shows "Separated in N s." for each song. If separation fails, it sends the plain audio and the site works as before.
