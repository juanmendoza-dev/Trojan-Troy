const MIME_TYPE_PREFERENCE = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];

export const MAX_RECORDING_MS = 60_000;

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

  const recorder = new MediaRecorder(stream, { mimeType });
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
