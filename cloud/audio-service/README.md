# Audio service (Google Cloud Run)

Lets a student hear a song in the key they pick. YouTube blocks Render, so when the
student page needs a song's audio, the site (`/api/song-audio/[id]`) asks this
small service on Google Cloud Run, which fetches it with yt-dlp and streams it
straight back. Nothing is saved. If the service fails, the site asks the helper on
the teacher's computer instead; if that's off too, the video plays in its original key.

- `server.mjs`: `GET /audio?v=<id>` streams the audio; `GET /check?v=<id>` only tests
  that YouTube lets it in. Both need `Authorization: Bearer <AUDIO_TOKEN>`.
- `Dockerfile`: Node 22 plus the latest yt-dlp at build time.
- `deploy.sh <project id>`: run in Cloud Shell to switch on or update the service.
  It prints `AUDIO_SERVICE_URL` and `AUDIO_SERVICE_TOKEN` for Render's Environment
  settings. Re-run it now and then to pick up a newer yt-dlp.

Cost: Cloud Run's free tier covers the requests and processing. Downloads to the
site are free up to 1 GB a month (very roughly 400 to 700 song loads), then a few
cents per GB. Keep a budget alert on the project.
