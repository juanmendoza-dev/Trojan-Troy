// Voice-clip duration helpers. `formatClipDuration` is pure (unit-tested);
// `measureClipDurationMs` touches the DOM/audio pipeline and is verified via
// end-to-end runs.

export function formatClipDuration(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.round(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Reads the real playback length of a recorded clip. MediaRecorder WebM/Opus
// output frequently reports `duration === Infinity` until the element is
// seeked to the end, so we handle that case explicitly.
export function measureClipDurationMs(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";

    const finish = (value: number) => {
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.onloadedmetadata = () => {
      if (audio.duration === Infinity || Number.isNaN(audio.duration)) {
        // Force the browser to resolve the real duration, then read it.
        audio.ontimeupdate = () => {
          if (audio.duration !== Infinity && !Number.isNaN(audio.duration)) {
            finish(audio.duration * 1000);
          }
        };
        audio.currentTime = 1e101;
      } else {
        finish(audio.duration * 1000);
      }
    };
    audio.onerror = () => {
      audio.onloadedmetadata = null;
      audio.ontimeupdate = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      reject(new Error("Could not read audio duration."));
    };

    audio.src = url;
  });
}
