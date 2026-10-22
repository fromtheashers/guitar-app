# Splits a song with Demucs (six-track model) for Chord Window's helper into: the
# harmony to read chords from (bass, piano/keys and pads, without guitar, which in
# worship music is often lead lines and swells), the drums, and everything else.
#
# Reads raw 32-bit float stereo at 44100 Hz on stdin; writes two 16-bit WAVs at
# 22050 Hz back to back on stdout: a stereo one (harmony left, drums right) and a
# mono one (the rest: vocals and guitar). Together they're the whole song. Plain
# stereo and mono WAVs decode the same in every browser. Nothing is written to disk.
# Uses the graphics card when it's free, and the processor otherwise.

import io
import os
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
    sys.stdout.buffer.write(wav_bytes(pcm[:, :2]) + wav_bytes(pcm[:, 2:]))


def gpu_is_free() -> bool:
    """Use the graphics card only when nothing else (a game, say) is busy on it."""
    if not torch.cuda.is_available():
        return False
    try:
        free, _ = torch.cuda.mem_get_info()
        if free < 2 * 1024**3:
            return False
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5,
        )
        return out.returncode == 0 and int(out.stdout.split()[0]) < 30
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
