const MIME_TYPE_PREFERENCE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export const MAX_RECORDING_MS = 60_000;

// Pinned rather than left to the browser's default, because clip size feeds
// straight into a hard ceiling: the relay closes any frame over 2 MiB
// (`maxPayload`), and a 60s clip at a browser's default Opus bitrate measured
// ~1.35 MB → ~1.81 MB on the wire once padded, sealed and base64'd — 86.5% of
// that cap. Different devices pick different defaults (and Safari falls back to
// mp4/AAC), so an unpinned bitrate left a device-dependent cliff where voice
// would fail with nothing in the UI to explain it. 32 kbps is a normal voice
// bitrate and puts a full-length clip near 16% of the cap instead.
const AUDIO_BITS_PER_SECOND = 32_000;

export class RecordingPermissionError extends Error {}
export class RecordingUnsupportedError extends Error {}

export interface RecordingHandle {
  stop(): void;
  result: Promise<{ blob: Blob; mimeType: string }>;
}

export async function startRecording(): Promise<RecordingHandle> {
  const mimeType = MIME_TYPE_PREFERENCE.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    throw new RecordingUnsupportedError("No supported audio recording format.");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new RecordingPermissionError("Microphone access denied.");
  }

  // A browser that doesn't honour audioBitsPerSecond clamps or ignores it rather
  // than throwing, so this is safe to pass unconditionally.
  const recorder = new MediaRecorder(stream, {
    mimeType,
    audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  const result = new Promise<{ blob: Blob; mimeType: string }>((resolve) => {
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
    };
  });

  recorder.start();
  const autoStopTimer = setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, MAX_RECORDING_MS);

  return {
    stop() {
      clearTimeout(autoStopTimer);
      if (recorder.state === "recording") recorder.stop();
    },
    result,
  };
}
