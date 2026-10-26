# Splits a song with Demucs (six-track model) for Chord Window's helper into: the
# harmony to read chords from (bass, piano/keys and pads, without guitar, which in
# worship music is often lead lines and swells), the drums, and everything else.
#
# Reads raw 32-bit float stereo at 44100 Hz on stdin; writes two 16-bit WAVs at
# 22050 Hz back to back on stdout: a stereo one (harmony left, drums right) and a
# mono one (the rest: vocals and guitar). Together they're the whole song. Plain
# stereo and mono WAVs decode the same in every browser. Nothing is written to disk.
# Uses the graphics card when it's free, and the processor otherwise.
#
# With CW_WORDS=1 in the environment it also transcribes the vocals with Whisper
# (pip install openai-whisper), primed with the lyric lines in CW_PROMPT, and appends
# the timed words as JSON: {"words": [[start, end, "word"], ...]}. The site uses them
# to name sections from the teacher's lyrics. If that fails, the WAVs still go out.

import inspect
import io
import json
import os
import time
import subprocess
import sys
import wave

import numpy as np
import torch
import torchaudio.functional as AF
from demucs.apply import apply_model
from demucs.pretrained import get_model

IN_SR = 44100
OUT_SR = 22050


def main() -> None:
    raw = sys.stdin.buffer.read()
    audio = np.frombuffer(raw, dtype=np.float32)
    if audio.size < IN_SR * 2:
        sys.exit("ERROR: no audio to separate")
    wav = torch.from_numpy(audio[: audio.size // 2 * 2].reshape(-1, 2).T.copy())

    device = "cuda" if gpu_is_free() else "cpu"
    if device == "cpu":
        # Leave cores free so the computer stays usable while a song is separated.
        torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    model = get_model("htdemucs_6s")
    model.eval()

    ref = wav.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with torch.inference_mode():
        stems = apply_model(model, ((wav - mean) / std)[None], device=device, shifts=0, split=True, overlap=0.25, progress=False)[0]
    stems = stems.cpu() * std + mean
    by_name = dict(zip(model.sources, stems))
    sources = model.sources
    # Free the graphics card for the speech model.
    del model
    if device == "cuda":
        torch.cuda.empty_cache()

    keys = by_name["piano"] + by_name["other"]
    guitar = by_name["guitar"]
    # A song carried by guitar alone (no keys or pads) still needs its chords.
    if float(keys.pow(2).mean()) < 0.1 * float(guitar.pow(2).mean()):
        keys = keys + guitar
        guitar = torch.zeros_like(guitar)
    harmony = (by_name["bass"] + keys).mean(0)
    drums = by_name["drums"].mean(0)
    rest = (by_name["vocals"] + guitar).mean(0)
    out = AF.resample(torch.stack([harmony, drums, rest]), IN_SR, OUT_SR)
    peak = float(out.abs().max()) or 1.0
    pcm = (out.T.numpy() / max(1.0, peak) * 32767).astype("<i2")
    words = b""
    if os.environ.get("CW_WORDS") == "1" and "vocals" in sources:
        words = transcribe(by_name["vocals"].mean(0), os.environ.get("CW_PROMPT", ""))
    sys.stdout.buffer.write(wav_bytes(pcm[:, :2]) + wav_bytes(pcm[:, 2:]) + words)


def transcribe(vocals: torch.Tensor, prompt: str) -> bytes:
    """Timed words sung in the vocals track, as JSON bytes; empty if it can't be done."""
    started = time.time()
    try:
        import whisper
    except Exception as e:  # not installed: say so in the helper's window
        print(f"NOTE: naming sections from lyrics needs openai-whisper ({e})", file=sys.stderr)
        return b""
    try:
        audio = AF.resample(vocals[None], IN_SR, 16000)[0].numpy().astype(np.float32)
        peak = float(np.abs(audio).max()) or 1.0
        audio = audio / peak * 0.9
        # Turbo needs about 5 GB of graphics memory; a smaller model runs on the processor.
        gpu = gpu_is_free(min_free_mb=5000)
        name = os.environ.get("CW_WHISPER_MODEL" if gpu else "CW_WHISPER_CPU_MODEL") or ("turbo" if gpu else "small")
        root = os.path.join(os.environ["TORCH_HOME"], "whisper") if os.environ.get("TORCH_HOME") else None
        model = whisper.load_model(name, device="cuda" if gpu else "cpu", download_root=root)

        # Most intros have no singing, so pick the language from the busiest 30 seconds.
        rms = frame_rms(audio, 16000)
        win = min(30, len(rms))
        busiest = int(np.argmax(np.convolve(rms, np.ones(win), mode="valid"))) if len(rms) else 0
        clip = whisper.pad_or_trim(audio[busiest * 16000 : busiest * 16000 + 30 * 16000])
        mel = whisper.log_mel_spectrogram(clip, model.dims.n_mels).to(model.device)
        _, probs = model.detect_language(mel)
        language = max(probs, key=probs.get)

        options = dict(
            language=language,
            word_timestamps=True,
            initial_prompt=prompt or None,
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
            fp16=gpu,
            verbose=None,
        )
        # Newer releases can keep the lyrics in view for every 30 seconds, not just the first.
        if prompt and "carry_initial_prompt" in inspect.signature(model.transcribe).parameters:
            options["carry_initial_prompt"] = True
        result = model.transcribe(audio, **options)
        # Drop words "heard" where the vocals are close to silent: the model's guesses.
        level = frame_rms(audio, 800)  # 50 ms frames
        floor = 0.08 * float(np.percentile(level, 90))
        words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                a, b = int(w["start"] * 20), max(int(w["start"] * 20) + 1, int(w["end"] * 20))
                if level[a:b].size and float(level[a:b].mean()) >= floor and w["word"].strip():
                    words.append([round(float(w["start"]), 2), round(float(w["end"]), 2), w["word"].strip()])
        del model
        if gpu:
            torch.cuda.empty_cache()
        print(f"NOTE: heard {len(words)} sung words in {time.time() - started:.0f} s ({name}, {'graphics card' if gpu else 'processor'})", file=sys.stderr)
        return json.dumps({"words": words}, ensure_ascii=False).encode("utf-8")
    except Exception as e:
        print(f"NOTE: couldn't transcribe the vocals: {e}", file=sys.stderr)
        return b""


def frame_rms(x: np.ndarray, n: int) -> np.ndarray:
    m = len(x) // n
    return np.sqrt((x[: m * n].reshape(m, n) ** 2).mean(1) + 1e-12)


def gpu_is_free(min_free_mb: int = 2048) -> bool:
    """Use the graphics card only when nothing else (a game, say) is busy on it."""
    if not torch.cuda.is_available():
        return False
    try:
        # Ask the driver, not PyTorch: on Windows PyTorch can't see what a game is using.
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode != 0:
            return False
        busy, used, total = (int(v) for v in out.stdout.splitlines()[0].split(","))
        return busy < 30 and total - used >= min_free_mb
    except Exception:
        return False


def wav_bytes(pcm: np.ndarray) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(OUT_SR)
        w.writeframes(np.ascontiguousarray(pcm).tobytes())
    return buf.getvalue()


if __name__ == "__main__":
    main()
