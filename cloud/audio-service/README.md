# Audio service (Google Cloud Run)

Lets a student hear a song in the key they pick. YouTube blocks cloud hosts like
Vercel, so when the student page needs a song's audio, the site
(`/api/song-audio/[id]`) signs a short-lived pass and the browser takes it to this
small service on Google Cloud Run, which fetches the audio with yt-dlp and streams
it straight back. Nothing is saved. If the service fails, the browser tries the
helper on the teacher's computer; if that's off too, the video plays in its
original key.

- `server.mjs`: `POST /audio` with `{"ticket": …}` (a pass signed with
  `AUDIO_TOKEN`) streams the audio. `GET /check?v=<id>` with
  `Authorization: Bearer <AUDIO_TOKEN>` only tests that YouTube lets it in.
- `Dockerfile`: Node 22 plus the latest yt-dlp at build time.
- `deploy.sh <project id>`: run in Cloud Shell to switch on or update the service.
  It prints `AUDIO_SERVICE_URL` and `AUDIO_SERVICE_TOKEN` for Vercel's Environment
  Variables. Re-run it now and then to pick up a newer yt-dlp.

Cost: Cloud Run's free tier covers the requests and processing. Downloads to the
site are free up to 1 GB a month (very roughly 400 to 700 song loads), then a few
cents per GB. Keep a budget alert on the project.
