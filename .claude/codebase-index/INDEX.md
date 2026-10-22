# Chord Window (guitar-app) index

## Overview
- Purpose: practice app for beginner guitar students learning worship songs. Students see chords, chord shapes and drum-based strum patterns in time with a YouTube video; the teacher drafts charts by capturing tab audio and analysing it in the browser.
- Stack: Next.js 16 App Router (cacheComponents on), React 19, TypeScript, CSS modules + global tokens, pg (Neon Postgres), vitest.
- Entry points: `src/app/layout.tsx` (shell), `src/app/page.tsx` (songs), `src/app/songs/[id]/page.tsx` (practice), `src/app/edit/**` (teacher), `src/app/api/**` (JSON API).
- Commands: `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`.
- Env: `DATABASE_URL`, `EDITOR_PASSCODE`, optional `SESSION_SECRET` (see `.env.example`).
- Conventions: read AGENTS.md (Next 16 differs from older versions: async params/cookies, `connection()`, Suspense for runtime data). Server pages wrap DB calls in try/catch → `<DbNotice>`, then call `notFound()` outside the try. No functions passed from server to client components. Design rules in DESIGN.md and PRODUCT.md.

## Structure
- `src/lib/music/`: pure music theory: chord parsing/transposition, chart text format, guitar shapes and capo choice, strum patterns from drum grooves.
- `src/lib/analysis/`: in-browser audio analysis (DSP, features, beat tracking, harmony, whole-song analyser) and tab-audio capture.
- `src/lib/`: server helpers (db, auth, validation, http) and client view-model (`songView.ts`).
- `src/components/`: client UI (practice view, chart, strum grid, chord diagrams, editors, YouTube hook).
- `src/app/`: pages and API routes.
- `.claude/skills/`: vendored agent skills (not app code; eslint ignores it).

## Key flows
- Practice: `songs/[id]/page.tsx` → `getSong` → `PracticeView` → `buildView` (songView) → `ChartView` + `StrumGrid` + `ChordDiagram`; `useYouTube` time drives `eventAt`.
- Drafting: `SongEditor` → `AnalysePanel` → `startTabCapture` (capture.ts) → `analyzeAudio` (analyze.ts → features/beats/harmony) → chart text + timings + patterns into the draft.
- Saving: editor `fetch` → `api/songs[/id]` → `requireEditor` (http.ts/auth.ts) → `songInput` (validate.ts) → `createSong`/`updateSong` (db.ts).
- Auth: `LoginForm` → `POST api/session` → `checkPasscode` + `signIn` (HMAC cookie "editor"); pages gate with `teacherGate()`.

## src/lib/music
### chords.ts
Purpose: chord and key model. Exports: parseChord, formatChord, transposeChord, simplifyChord, nashville, parseKey, keyName, prefersFlats, chordTones, qualityFamily, mod12; types Chord, Key.
### chart.ts
Purpose: chart text format (sections `[X]`, bars `| |`, `.` hold, `%` repeat, `N.C.`, `> cue`, inline ChordPro). Exports: parseChart(text, beatsPerBar) → {sections, events, errors}; serializeChart; sectionKind; distinctChords. Timings are indexed by chord-change event.
### guitar.ts
Purpose: chord shapes (open/worship voicings, E/A barre templates) and difficulty. Exports: shapesFor, difficulty, bestCapo(chords, easy), shapeMatchesChord.
### strum.ts
Purpose: DrumGroove → StrumPattern (D/U/x/-, accents). Exports: strokesFromGroove, patternFromGroove, strokesForMode (easy = downs on kick/snare beats), GROOVE_PRESETS, presetPattern, defaultPresetFor, countLabels, slotsPerBeat.
### music.test.ts — unit tests for the above.

## src/lib/analysis
### dsp.ts — fft, hann, resample, stft, percentile, mean.
### features.ts — SR=22050; onsetFeatures (kick/snare/hat bands), chromaFeatures (tuning, bass chroma), frame-time helpers.
### beats.ts — estimateTempo (autocorrelation, 100 BPM prior), trackBeats (DP), fillGaps.
### harmony.ts — detectKey (Krumhansl), STATES/NO_CHORD, labelBeats (Viterbi), slashBass.
### analyze.ts
Purpose: whole-song analysis. Exports: analyzeAudio(samples, {beatsPerBar, toVideoTime, onProgress}) → AnalysisResult {bpm, key, chart, timings, patterns, confidence}. Notes: downbeat from kick + chord changes, half-bar chords, 4-bar phrase grouping into sections named by energy, groove per section kind; 6/8 tracked as 2 pulses.
### capture.ts
Purpose: getDisplayMedia tab-audio capture via AudioWorklet, in memory only. Exports: startTabCapture(videoTime, onEnded) → CaptureHandle {finish, cancel, elapsed, level}; CaptureError (unsupported/denied/no-audio/too-short, min 20 s); tabCaptureSupported; videoTimeMap.
### analyze.test.ts — synthetic-song end-to-end tests.

## src/lib (other)
### db.ts — server-only Pool + auto-created schema (songs, setlists). Exports CRUD: listSongs, getSong, getSongs, createSong, updateSong, deleteSong, listSetlists, getSetlist, createSetlist, updateSetlist, deleteSetlist, isId; types Song, SongInput, SongSummary, Setlist, SetlistItem, SetlistInput.
### auth.ts — passcodeConfigured, checkPasscode, isEditor, signIn, signOut (HMAC cookie).
### validate.ts — songInput, setlistInput (sanitise request bodies).
### http.ts — json, problem, requireEditor, readJson, dbError for API routes.
### songView.ts — buildView(song, {mode, key, capo, numbers}) → SongView (sections with patterns and times, events, shapes, capo, keys); eventAt, keyDistance, ALL_KEYS, ALL_MINOR_KEYS.
### sections.ts (sectionHue), youtube.ts (youtubeId), brand.ts (APP_NAME placeholder).

## src/components
### PracticeView.tsx — student practice screen: video, mode/key/capo/numbers/speed controls (saved in localStorage), now pane, strum grid, chart following the video, section looping, shortcuts.
### ChartView.tsx — chart as leaded panes per section; props view, beatsPerBar, activeEvent, onSeek, onLoopSection, loopedSection.
### StrumGrid.tsx — drum rows + strum row; editable when onChange given.
### ChordDiagram.tsx — SVG chord box (pickShape), sizes s/m/l.
### SongEditor.tsx — teacher song editor: details, video, AnalysePanel, tap-to-sync, chart text + live preview, per-section patterns, notes, save (Ctrl+S)/delete.
### AnalysePanel.tsx — "Listen and draft" flow around capture + analyzeAudio, with progress, summary and undo.
### SetlistEditor.tsx — name, description, ordered songs with per-song key.
### useYouTube.ts — IFrame API hook → {host, player, ready, state, error}; PLAYING, ENDED.
### NavLinks.tsx (active nav, Suspense-wrapped), LoginForm.tsx (LoginForm, SignOutButton), TeacherGate.tsx (teacherGate()), SongList.tsx, DbNotice.tsx, Mark.tsx.

## src/app
- `layout.tsx` shell + font; `loading.tsx` Suspense fallback (needed by cacheComponents); `not-found.tsx`.
- `page.tsx` songs; `songs/[id]` practice; `setlists`, `setlists/[id]` (links pass `?key=`).
- `edit/page.tsx` teacher dashboard; `edit/songs/new|[id]`, `edit/setlists/new|[id]`.
- `api/session` (POST sign in, DELETE sign out); `api/songs`, `api/songs/[id]`, `api/setlists`, `api/setlists/[id]` (GET public, writes need editor cookie).
