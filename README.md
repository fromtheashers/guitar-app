# Chord Window

A practice app for beginner guitar students learning worship songs. Students open a song and see the chords, a strum pattern based on the track's drums, and chord shapes, all moving in time with the YouTube video. Easy mode simplifies chords and picks a capo; advanced mode shows the full voicings and accents.

The teacher signs in with a passcode, pastes a YouTube link, and presses **Draft from YouTube**: the helper on the teacher's home computer fetches the video's audio with yt-dlp and hands it straight to the browser, which runs a trained chord-recognition model (BTC, MIT licence, in `public/models/`) and works out the key, tempo, chords, sections, timings and per-section strum patterns in the browser, and writes a draft chart to check and save. Audio is processed in memory and never stored. A backup option on desktop Chrome or Edge captures the tab's audio while the video plays instead.

Charts hold chords and section labels, plus optional short lyric cues.

## Running locally

1. Install Node 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and `EDITOR_PASSCODE`.
3. `npm run dev`, then open http://localhost:3000.

The tables are created automatically the first time the app talks to the database.

## Chart format

```
[Verse 1]
> Amazing grace
| G | C G | Em . . D | C |
| % | D |
```

- `[Name]` starts a section. Names like Verse, Chorus, Bridge, Intro and Outro choose the colour and strum pattern.
- Bars sit between `|`. Each word is one beat; `.` holds the chord for another beat. A bar with one chord lasts the whole bar, and two chords split it evenly.
- `%` repeats the previous bar, `N.C.` means no chord, slash chords like `D/F#` work.
- `> words` adds a short lyric cue to the next bar.

## Commands

- `npm run dev` · development server
- `npm run build` / `npm start` · production build and server
- `npm test` · music and audio-analysis tests
- `npm run lint`

## Deploying on Vercel

The app deploys to Vercel with no extra configuration (Vercel builds it from the main branch). Set these in the project's **Settings → Environment Variables**, then redeploy:

- `DATABASE_URL`: the Neon connection string. Use Neon's **pooled** string (the host contains `-pooler`), since Vercel opens many short-lived connections.
- `EDITOR_PASSCODE`: the teacher passcode.
- `HELPER_TOKEN`: the password shared with the helper on the teacher's computer (see below).
- `AUDIO_SERVICE_URL`, `AUDIO_SERVICE_TOKEN`: the Google Cloud audio service (see `cloud/audio-service/README.md`).

### Where YouTube audio comes from

YouTube blocks cloud servers, and Vercel can't hold a long-running download, so the site never touches audio. It hands the browser a short-lived signed pass, and the browser fetches the audio from:

- **The helper** in `helper/` (drafting, and the backup for students): runs on the teacher's home computer, which YouTube doesn't block, and is reached through a free Cloudflare tunnel. It tells the site its current address every minute. See `helper/README.md`.
- **The Google Cloud audio service** in `cloud/audio-service/` (students changing key).
