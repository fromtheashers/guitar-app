# YouTube helper

Runs on a home computer so YouTube downloads come from a home connection, which YouTube doesn't block. Audio stays in memory and is never saved.

The site (on Vercel) never handles audio. The helper runs a small server on `127.0.0.1:47321` and reaches the internet through a free Cloudflare quick tunnel (`cloudflared`, no account or router changes). Every minute it tells the site its tunnel address. When a browser needs audio, the site signs a two-minute pass with the shared password (`HELPER_TOKEN`); the browser hands it to the helper (`POST /jobs`), then collects the audio (`GET /jobs/<id>`, 202 until ready, sent once). Jobs run one at a time.

**Windows setup:** run `setup.ps1 -Site https://your-site.vercel.app` in PowerShell. It installs Node (if missing), yt-dlp and cloudflared into `%LOCALAPPDATA%\ChordWindowHelper`, creates a password, registers a task that starts the helper at sign-in, and opens `PASTE-INTO-VERCEL.txt`. Add that value as `HELPER_TOKEN` in Vercel's Environment Variables, then redeploy.

**Moving from the old (Render) helper:** run `move-to-vercel.ps1 -Site https://your-site.vercel.app` from the folder with the new `helper.mjs`. It keeps the password and separation settings.

Re-run the setup script now and then to update yt-dlp when YouTube changes something.

## Optional: vocal and drum separation

With separation set up, the helper splits each song with Demucs before sending it: the site then reads chords from the instruments alone and strum patterns from the drums alone. It runs only while a song is being drafted.

1. Make a Python 3.12 environment outside AppData (for example `C:\ChordWindow\sep\venv`) and install `torch`, `torchaudio` (the CUDA build if the computer has an NVIDIA card), `demucs` and `soundfile`.
2. Put ffmpeg where the helper can find it: `ffmpeg.exe` next to `helper.mjs`, on PATH, or `"ffmpeg"` in `separator.json`.
3. Next to `helper.mjs`, create `separator.json` (no password goes in it):
   `{"separator": "C:\\ChordWindow\\sep\\venv\\Scripts\\python.exe", "separatorScript": "C:\\ChordWindow\\sep\\separate.py", "models": "C:\\ChordWindow\\sep\\models"}`
4. Restart the helper. Its window shows "Separated in N s." for each song. If separation fails, it sends the plain audio and the site works as before.

## Optional: naming sections from lyrics

With separation set up, the helper can also transcribe the separated vocals with Whisper when a draft comes with lyrics, so the site names sections (Verse 2, Chorus) from what is sung. The words go back to the browser with the audio and are never stored.

Run `add-lyrics.ps1` from the folder with the new `helper.mjs` and `separate.py`. It copies them into place, installs `openai-whisper` into the separation Python, downloads the `turbo` (graphics card, needs about 5 GB free) and `small` (processor) models into `models\whisper`, and restarts the helper. `"lyricsModel"` and `"lyricsModelCpu"` in `separator.json` pick other models. The helper window shows "heard N sung words" for each song.
