# Chord Window

A practice app for beginner guitar students learning worship songs. Students open a song and see the chords, a strum pattern based on the track's drums, and chord shapes, all moving in time with the YouTube video. Easy mode simplifies chords and picks a capo; advanced mode shows the full voicings and accents.

The teacher signs in with a passcode, pastes a YouTube link, and presses **Listen and draft**: the app captures the tab's audio while the video plays (Chrome or Edge on a laptop), works out the key, tempo, chords, sections, timings and per-section strum patterns in the browser, and writes a draft chart to check and save. Audio is processed in memory and never stored or uploaded.

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

## Deploying on Render

`render.yaml` describes the service. Set `DATABASE_URL` (from Neon) and `EDITOR_PASSCODE` in Render's Environment settings.
