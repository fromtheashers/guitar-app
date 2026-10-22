# Chord Window

A practice app for beginner guitar students learning worship songs. Students open a song and see the chords, a strum pattern based on the track's drums, and chord shapes, all moving in time with the YouTube video. Easy mode simplifies chords and picks a capo; advanced mode shows the full voicings and accents.

The teacher signs in with a passcode, pastes a YouTube link, and presses **Draft from YouTube**: the server streams the video's audio through yt-dlp to the browser, which runs a trained chord-recognition model (BTC, MIT licence, in `public/models/`) and works out the key, tempo, chords, sections, timings and per-section strum patterns in the browser, and writes a draft chart to check and save. Audio is processed in memory and never stored. A backup option on desktop Chrome or Edge captures the tab's audio while the video plays instead.

Charts hold chords and section labels, plus optional short lyric cues.

## Running locally

1. Install Node 22 and run `npm ci`.
2. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` and `EDITOR_PASSCODE`.
3. Run `sh scripts/install-yt-dlp.sh` (Linux) or install yt-dlp yourself, or set `YTDLP_PATH`.
4. `npm run dev`, then open http://localhost:3000.

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

## Deploying on Render

`render.yaml` describes the service. Set `DATABASE_URL` (from Neon) and `EDITOR_PASSCODE` in Render's Environment settings.

### YouTube helper (recommended)

YouTube blocks most cloud servers. The helper in `helper/` runs on a home computer, polls the site for work, and downloads audio over the home connection. See `helper/README.md`. When `HELPER_TOKEN` is set in Render, all YouTube downloads go through it.

### Letting the server past YouTube's bot check (alternative)

YouTube blocks most cloud servers unless they're signed in. To sign the server in, use a spare Google account (not your main one):

1. In a desktop browser, sign in to YouTube with the spare account.
2. Export its youtube.com cookies in Netscape `cookies.txt` format (for example with the "Get cookies.txt LOCALLY" extension).
3. In Render, open the service, go to **Environment**, and under **Secret Files** add a file named `youtube-cookies.txt` with the exported text.
4. Save. Render redeploys, and the server reads `/etc/secrets/youtube-cookies.txt`.

Cookies last weeks to months; when YouTube blocks the server again, export them again. Without cookies, the microphone option still works on any device.
