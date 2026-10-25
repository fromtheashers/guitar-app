# Chord Window (guitar-app) index

## Overview
- Purpose: practice app for beginner guitar students learning worship songs. Students see chords, chord shapes and drum-based strum patterns in time with a YouTube video; the teacher drafts charts by capturing tab audio and analysing it in the browser.
- Stack: Next.js 16 App Router (cacheComponents on), React 19, TypeScript, CSS modules + global tokens, pg (Neon Postgres), vitest.
- Entry points: `src/app/layout.tsx` (shell), `src/app/page.tsx` (songs), `src/app/songs/[id]/page.tsx` (practice), `src/app/edit/**` (teacher), `src/app/api/**` (JSON API).
- Commands: `npm run dev`, `npm run build`, `npm start`, `npm test`, `npm run lint`.
- Env: `DATABASE_URL`, `EDITOR_PASSCODE`, optional `SESSION_SECRET`, `HELPER_TOKEN`, `AUDIO_SERVICE_URL` + `AUDIO_SERVICE_TOKEN` (see `.env.example`).
- Conventions: read AGENTS.md (Next 16 differs from older versions: async params/cookies, `connection()`, Suspense for runtime data). Server pages wrap DB calls in try/catch → `<DbNotice>`, then call `notFound()` outside the try. No functions passed from server to client components. Design rules in DESIGN.md and PRODUCT.md.

## Structure
- `src/lib/music/`: pure music theory: chord parsing/transposition, chart text format, instruments (guitar, ukulele, baritone ukulele, mandolin, bass) with chord shapes and capo choice, strum patterns from drum grooves.
- `src/lib/analysis/`: in-browser audio analysis (DSP, features, beat tracking, harmony, whole-song analyser) and tab-audio capture.
- `src/lib/`: server helpers (db, auth, validation, http) and client view-model (`songView.ts`).
- `src/components/`: client UI (practice view, chart, strum grid, chord diagrams, editors, YouTube hook).
- `src/app/`: pages and API routes.
- `cloud/audio-service/`: Google Cloud Run service (server.mjs, Dockerfile, deploy.sh for Cloud Shell) that streams a YouTube video's audio with yt-dlp for students changing key; bearer AUDIO_TOKEN; never stores.
- `src/lib/audio/`: client pitch/tempo shifting (pitchShift.ts, shift.worker.ts).
- `helper/`: home-computer YouTube helper (helper.mjs, reports ?v=2 when polling; "listen" jobs fetch small AAC and skip separation; Windows setup.ps1 that installs Node + yt-dlp and a logon task; optional separate.py runs Demucs six-track separation, configured by separator.json next to helper.mjs, GPU only when nvidia-smi shows it free, low process priority).
- `.claude/skills/`: vendored agent skills (not app code; eslint ignores it).

## Key flows
- Practice: `songs/[id]/page.tsx` → `getSong` → `PracticeView` → `buildView` (songView) → `ChartView` + `StrumGrid` + `ChordDiagram`; `useYouTube` time drives `eventAt`.
- Key change audio: `PracticeView` (semitones = keyDistance(original, chosen key)) → `useShiftedAudio` → `GET api/song-audio/[id]` (public, songs in the DB only, 20/hour per IP) → Cloud Run service (AUDIO_SERVICE_URL + AUDIO_SERVICE_TOKEN) else `fetchViaHelper(id, "listen")` when `helperCanListen()` (helper v2+) else 503 → decode at 32 kHz mono → shift.worker (shiftPitch with tempo = speed) → AudioBufferSourceNode kept within 0.2 s of the muted video; original key or any failure = normal video.
- Drafting (main): `AnalysePanel` → `fetchYouTubeAudio` (fetchAudio.ts) → `GET api/youtube-audio` → if HELPER_TOKEN: `fetchViaHelper` (helperQueue.ts; home helper long-polls `api/helper/next`, posts to `api/helper/result/[id]`) else `streamAudio` (ytAudio.ts, spawns bin/yt-dlp, stdout piped, never stored) (optionally the helper separates with helper/separate.py and sends a stereo WAV (harmony = bass+keys+pads, drums) followed by a mono WAV (vocals+guitar), flagged x-stems; fetchAudio splits them by RIFF size) → decode at 22050 Hz → `cqtFrames` (on the instruments when separated) (cqt.ts) → `chordProbabilities` (chordModel.ts, BTC ONNX model in public/models, onnxruntime-web wasm copied to public/ort by scripts/copy-ort.mjs) → `analyzeAudio({chordProbs})`; if the model fails to load, analyzeAudio uses the template engine.
- Drafting (backup, desktop Chrome/Edge): `SongEditor` → `AnalysePanel` → `startTabCapture` (capture.ts) → `analyzeAudio` (analyze.ts → features/beats/harmony) → chart text + timings + patterns into the draft.
- Saving: editor `fetch` → `api/songs[/id]` → `requireEditor` (http.ts/auth.ts) → `songInput` (validate.ts) → `createSong`/`updateSong` (db.ts).
- Link auto-fill: `SongEditor` (on new videoId) → `GET api/video-info` (teacher only) → fetchVideoFacts + guessSong → fills only empty fields.
- Auth: `LoginForm` → `POST api/session` → `checkPasscode` + `signIn` (HMAC cookie "editor"); pages gate with `teacherGate()`.

## src/lib/music
### chords.ts
Purpose: chord and key model. Exports: parseChord, formatChord, transposeChord, simplifyChord, nashville, parseKey, keyName, prefersFlats, chordTones, qualityFamily, mod12; types Chord, Key.
### chart.ts
Purpose: chart text format (sections `[X]`, bars `| |`, `.` hold, `%` repeat, `N.C.`, `> cue`, inline ChordPro). Exports: parseChart(text, beatsPerBar) → {sections, events, errors}; serializeChart; sectionKind; distinctChords. Timings are indexed by chord-change event.
### guitar.ts
Purpose: guitar chord shapes (open/worship voicings, E/A barre templates). Exports: guitarShapes, types Shape, Frets (number[], diagram order).
### instruments.ts
Purpose: per-instrument shapes, difficulty and capo. INSTRUMENTS (guitar, ukulele GCEA re-entrant, baritone DGBE, mandolin GDAE, bass EADG with role "bass" and no capo), GUITAR, getInstrument(id). shapesFor(symbol, inst) (memoised; guitar → guitarShapes; ukulele/mandolin hand table then searchShapes, a scored fretboard search over four-fret windows; slash bass dropped on 4-string chord instruments; bass → one dot on the bass note), difficulty(symbol, inst), bestCapo(chords, easy, inst) (no capo for bass), shapeMatchesChord(shape, chord, inst).
### strum.ts
Purpose: DrumGroove → StrumPattern (D/U/x/-, accents). Exports: strokesFromGroove, patternFromGroove, strokesForMode (easy = downs on kick/snare beats), GROOVE_PRESETS, presetPattern, defaultPresetFor, countLabels, slotsPerBeat.
### music.test.ts — unit tests for the above (every chord on every non-guitar instrument uses only chord tones).

## src/lib/analysis
### dsp.ts — fft, hann, resample, stft, percentile, mean.
### features.ts — SR=22050; onsetFeatures(samples, isolated?) (kick/snare/hat bands; isolated = plain-magnitude flux for a separated drums track), chromaFeatures (tuning, bass chroma), frame-time helpers.
### beats.ts — estimateTempo (autocorrelation, 100 BPM prior), trackBeats (DP), fillGaps.
### harmony.ts — detectKey (Krumhansl), STATES/NO_CHORD, labelBeats (Viterbi), slashBass.
### cqt.ts — cqtFrames(samples) → {data (log CQT, 144 bins, frame-major), times}; multirate CQT matching librosa/BTC features.
### chordModel.ts — trained BTC model (MIT, 170 classes) via onnxruntime-web, single-threaded. Exports VOCAB, CLASSES, chordProbabilities(frames) → {probs, times}.
### modelHarmony.ts — folds the model's 170 classes into 73 chart chords (FAMILY_STATES: plain, m, 7, sus4, dim, aug per root, plus N); beatProbabilities (frame → beat), chordPrior(key) (diatonic/borrowed/out-of-key), labelBeatsWithModel(probs, prior) (Viterbi).
### analyze.ts
Purpose: whole-song analysis. Exports: analyzeAudio(samples, {beatsPerBar, toVideoTime, onProgress, chordProbs?}) → AnalysisResult {bpm, key, chart, timings, patterns, confidence}. Notes: with chordProbs, a first labelling pass finds the key, a second favours chords in it; slash bass needs a 3x dominant bass. Downbeats via findDownbeats (Viterbi over bar position, bars may run a beat short/long); a half bar gets its own chord only if it holds the whole half. findSections picks the phrase offset by repeat similarity, pairs halves, folds pickups, names Intro/Outro bookends, Bridge, lead-in Pre-Chorus. Older notes: downbeat from kick + chord changes, half-bar chords, 4-bar phrase grouping into sections named by energy, groove per section kind; 6/8 tracked as 2 pulses.
## src/lib/audio
### pitchShift.ts — shiftPitch(samples, sr, semitones, tempo, onProgress) (WSOLA stretch 40/8/15 ms with coarse-to-fine match, then Catmull-Rom resample); stretch, resample. Tests in pitchShift.test.ts. ~0.5 s for a 4-min song on a laptop.
### shift.worker.ts — worker: "load" samples once, "shift" {job, semitones, tempo} → progress/done (transferred). Types ShiftRequest, ShiftReply.

### fetchAudio.ts — fetchYouTubeAudio(url, onBytes, signal) → mono Float32Array at SR; picks m4a or webm by browser codec support.
### capture.ts — also startMicCapture (microphone backup) and micCaptureSupported.
### capture.ts (tab)
Purpose: getDisplayMedia tab-audio capture via AudioWorklet, in memory only. Exports: startTabCapture(videoTime, onEnded) → CaptureHandle {finish, cancel, elapsed, level}; CaptureError (unsupported/denied/no-audio/too-short, min 20 s); tabCaptureSupported; videoTimeMap.
### analyze.test.ts — synthetic-song end-to-end tests.

## src/lib (other)
### db.ts — server-only Pool + auto-created schema (songs, setlists). Exports CRUD: listSongs, getSong, getSongs, createSong, updateSong, deleteSong, listSetlists, getSetlist, createSetlist, updateSetlist, deleteSetlist, isId; types Song, SongInput, SongSummary, Setlist, SetlistItem, SetlistInput.
### auth.ts — passcodeConfigured, checkPasscode, isEditor, signIn, signOut (HMAC cookie).
### validate.ts — songInput, setlistInput (sanitise request bodies).
### http.ts — json, problem, requireEditor, readJson, dbError for API routes.
### glance.ts — glance(view) → sections of folded four-bar lines (glanceLines, foldLines: one line or a two-line phrase repeated back to back); glanceChords. Tests in glance.test.ts.
### songView.ts — buildView(song, {mode, key, capo, numbers, instrument?}) → SongView (sections with patterns and times, events, shapes, capo, keys); eventAt, keyDistance, ALL_KEYS, ALL_MINOR_KEYS.
### videoInfo.ts — pure: guessSong(VideoFacts) → SongGuess {title, artist, spotifyUrl, key, bpm, beatsPerBar} from title/channel/description/Music card; cleanTitle, embeddedJson, musicSection. Tests in videoInfo.test.ts.
### ytAudio.ts — server-only streamAudio(id, format, signal) → ReadableStream from yt-dlp (YTDLP_PATH or ./bin/yt-dlp, installed by scripts/install-yt-dlp.sh at Render build); explain(stderr) → readable error. 15-min/60 MB caps.
### helperQueue.ts — server-only in-memory job queue for the home helper: helperConfigured, helperOnline (polled <45 s ago), helperCanListen (online and version ≥ 2), checkHelperToken, fetchViaHelper(id, format m4a|webm|listen), nextJob(signal, version) (25 s long poll), finishJob.
### videoFetch.ts — server-only fetchVideoFacts(id): YouTube oEmbed + watch page (best effort, 5 s timeout).
### sections.ts (sectionHue), youtube.ts (youtubeId), brand.ts (APP_NAME placeholder), share.ts (shareLink: share sheet, else copy link).

## src/components
### PracticeView.tsx — student practice screen. Left column: video, Easy/Advanced plus settings (instrument saved as pref:instrument, also set by ?instrument= on the song URL; key, capo (hidden for bass), numbers, speed; folded behind one summary button at ≤960px), capo line, SongGlance (open state saved as pref:glance), chart (ChartView with beat ticks), chord shapes, notes. Player pane (sticky right on laptops, docked to the bottom at ≤960px, height fed to --dock): section, current chord + diagram, next chord, StrumGrid (strum row only when docked), progress bar with section marks (range input scrub), transport (Play/Pause, Stop, ±5 s, Auto-scroll checkbox saved as pref:follow). Tapping a bar or looping starts one bar early; arrows move time even when paused; screen wake lock (useWakeLock) until ten idle minutes. In a non-original key, useShiftedAudio plays shifted audio and ShiftNote in the capo line shows progress / "Audio in X" / tap-to-hear / "Audio stays in …" with the reason.
### SongGlance.tsx — "Song at a glance": static card of the whole song (glance.ts), sections tinted by hue, repeats as ×N, held bars as "–", chord list; Hide/Show.
### ChartView.tsx — chart as leaded panes per section; props view, beatsPerBar, activeEvent, onSeek, onLoopSection, loopedSection; onPick + picked (editor) make each chord a button (untimed ones dimmed). activeBeat draws beat ticks along the foot of the active bar.
### StrumGrid.tsx — drum rows + strum row (lanes / showStrum props: bass shows only the kick row, "Rhythm"); editable when onChange given (tap cycles a strum; press-and-hold 450 ms or right-click accents).
### ChordDiagram.tsx — SVG chord box (pickShape(chord, easy, instrument)), any string count (4-string boxes use wider gaps), bass draws no × marks; sizes s/m/l; caption={false} hides the name visually.
### SongEditor.tsx — teacher song editor: YouTube link first, details (title, artist, Spotify, key, time, BPM) folded in a <details> with a summary line, unsaved draft kept in localStorage `song-draft:<id|new>` with a restore banner, Share button, video, AnalysePanel, tap-to-sync (from the start, or from any chord picked in the preview; Back one = Backspace replays from a run-up), sticky sync bar over the preview (picked chord: tap from here, set to video time, ±0.1 s for that chord, ±1 beat for it and all later), chart text sticky on laptops, ChartKeys while the chart is focused, per-section patterns, notes, save (Ctrl+S)/delete. At ≤900px: Save bar fixed to the bottom; while tapping, a fixed tap pad (next/then chord, big tap on pointerdown, Back one, Done) replaces it and the video scrolls to the top.
### ChartKeys.tsx — touch-only (pointer: coarse) toolbar fixed above the on-screen keyboard (visualViewport inset): | . chords in the key (keyChords) + chords used, section and cue inserts; keeps textarea focus.
### AnalysePanel.tsx — "Draft from YouTube" (plus mic/tab backups) → chord model → analyzeAudio, with progress, summary and undo. Holds a screen wake lock while fetching/listening/working.
### SetlistEditor.tsx — name, description, ordered songs with per-song key; drag by the number/grip handle (pointer events) or Up/Down; search-to-add list; Share button.
### useWakeLock.ts — useWakeLock(on): screen wake lock, retaken when the page is visible again (AnalysePanel, PracticeView).
### useShiftedAudio.ts — useShiftedAudio({songId, semitones, rate, player}) → ShiftStatus (off, loading, shifting{done}, ready{blocked}, failed{reason}). Fetches once per page, re-renders per key/speed (400 ms debounce), mutes the video only while its audio is playing, resumes the AudioContext on pointerdown/keydown, sets navigator.audioSession to playback (iPhone silent switch).
### useYouTube.ts — IFrame API hook (player type includes mute/unMute) → {host, player, ready, state, error}; PLAYING, BUFFERING, ENDED.
### NavLinks.tsx (active nav, Suspense-wrapped), LoginForm.tsx (LoginForm, SignOutButton), TeacherGate.tsx (teacherGate()), SongList.tsx, DbNotice.tsx, Mark.tsx.

## src/app
- `layout.tsx` shell + font; `loading.tsx` Suspense fallback (needed by cacheComponents); `not-found.tsx`.
- `page.tsx` songs; `songs/[id]` practice; `setlists`, `setlists/[id]` (links pass `?key=`).
- `edit/page.tsx` teacher dashboard; `edit/songs/new|[id]`, `edit/setlists/new|[id]`.
- `api/session` (POST sign in, DELETE sign out); `api/songs`, `api/songs/[id]`, `api/setlists`, `api/setlists/[id]` (GET public, writes need editor cookie); `api/video-info?url=` and `api/youtube-audio?url=&format=` (teacher only); `api/song-audio/[id]` (public, key-change audio).
