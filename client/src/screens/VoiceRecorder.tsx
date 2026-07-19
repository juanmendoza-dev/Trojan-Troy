import { useEffect, useRef, useState } from "react";
import {
  startRecording,
  MAX_RECORDING_MS,
  RecordingPermissionError,
  RecordingUnsupportedError,
  type RecordingHandle,
} from "../audio/recorder";

interface VoiceRecorderProps {
  onSend: (blob: Blob, mimeType: string) => void;
}

type RecorderState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "preview"; blob: Blob; mimeType: string; audioUrl: string }
  | { status: "error"; message: string };

export function VoiceRecorder({ onSend }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef<RecordingHandle | null>(null);
  const isStartingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state.status !== "recording") return;
    const interval = setInterval(() => setElapsedMs((ms) => ms + 250), 250);
    return () => clearInterval(interval);
  }, [state.status]);

  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      if (stateRef.current.status === "preview") {
        URL.revokeObjectURL(stateRef.current.audioUrl);
      }
    };
  }, []);

  async function handleStart() {
    if (isStartingRef.current || state.status !== "idle") return;
    isStartingRef.current = true;
    try {
      const handle = await startRecording();
      handleRef.current = handle;
      setElapsedMs(0);
      setState({ status: "recording" });
      handle.result.then(({ blob, mimeType }) => {
        setState({ status: "preview", blob, mimeType, audioUrl: URL.createObjectURL(blob) });
      });
    } catch (error) {
      const message =
        error instanceof RecordingPermissionError
          ? "Microphone access denied."
          : error instanceof RecordingUnsupportedError
            ? "Voice recording isn't supported in this browser."
            : "Could not start recording.";
      setState({ status: "error", message });
    } finally {
      isStartingRef.current = false;
    }
  }

  function handleStop() {
    handleRef.current?.stop();
  }

  function handleDiscard() {
    if (state.status === "preview") URL.revokeObjectURL(state.audioUrl);
    setState({ status: "idle" });
  }

  function handleSend() {
    if (state.status !== "preview") return;
    onSend(state.blob, state.mimeType);
    URL.revokeObjectURL(state.audioUrl);
    setState({ status: "idle" });
  }

  if (state.status === "idle") {
    return <button onClick={handleStart}>Record voice message</button>;
  }
  if (state.status === "recording") {
    return (
      <div>
        <span>
          Recording... {Math.floor(elapsedMs / 1000)}s / {MAX_RECORDING_MS / 1000}s
        </span>
        <button onClick={handleStop}>Stop</button>
      </div>
    );
  }
  if (state.status === "preview") {
    return (
      <div>
        <audio src={state.audioUrl} controls />
        <button onClick={handleSend}>Send</button>
        <button onClick={handleDiscard}>Discard</button>
      </div>
    );
  }
  return (
    <div>
      <span>{state.message}</span>
      <button onClick={() => setState({ status: "idle" })}>Dismiss</button>
    </div>
  );
}
