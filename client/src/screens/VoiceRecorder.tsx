import { useEffect, useRef, useState } from "react";
import {
  startRecording,
  MAX_RECORDING_MS,
  RecordingPermissionError,
  RecordingUnsupportedError,
  type RecordingHandle,
} from "../audio/recorder";
import { Icon } from "../components/Icon";

export type RecorderStatus = "idle" | "recording" | "preview" | "error";

interface VoiceRecorderProps {
  onSend: (blob: Blob, mimeType: string) => void;
  onRecordingChange?: (isRecording: boolean) => void;
  /**
   * Every status change, not just recording. The composer needs it so that on
   * mobile a busy recorder can take over the whole row instead of being squeezed
   * in beside the input.
   */
  onStatusChange?: (status: RecorderStatus) => void;
}

type RecorderState =
  | { status: "idle" }
  | { status: "recording" }
  | { status: "preview"; blob: Blob; mimeType: string; audioUrl: string }
  | { status: "error"; message: string };

export function VoiceRecorder({ onSend, onRecordingChange, onStatusChange }: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderState>({ status: "idle" });
  const [elapsedMs, setElapsedMs] = useState(0);
  const handleRef = useRef<RecordingHandle | null>(null);
  const isStartingRef = useRef(false);
  const mountedRef = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  const onRecordingChangeRef = useRef(onRecordingChange);
  onRecordingChangeRef.current = onRecordingChange;
  const onStatusChangeRef = useRef(onStatusChange);
  onStatusChangeRef.current = onStatusChange;

  // Report recording start/stop up so the peer can see a "recording…" indicator,
  // and the whole status so the composer can lay itself out around us.
  useEffect(() => {
    onRecordingChangeRef.current?.(state.status === "recording");
    onStatusChangeRef.current?.(state.status);
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "recording") return;
    const interval = setInterval(() => setElapsedMs((ms) => ms + 250), 250);
    return () => clearInterval(interval);
  }, [state.status]);

  useEffect(() => {
    // Set on the way in, not just cleared on the way out: StrictMode mounts,
    // unmounts and re-mounts in dev, and without this the flag stayed false for
    // the rest of the session — so a finished recording never became a preview.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
        if (!mountedRef.current) return;
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
    return (
      <button
        type="button"
        className="composer__mic"
        onClick={handleStart}
        aria-label="Record voice message"
      >
        <Icon name="mic" size={18} />
      </button>
    );
  }
  if (state.status === "recording") {
    return (
      <div className="composer__recording">
        <span className="composer__recording-time">
          {Math.floor(elapsedMs / 1000)}s / {MAX_RECORDING_MS / 1000}s
        </span>
        <button type="button" className="composer__stop" onClick={handleStop}>
          Stop
        </button>
      </div>
    );
  }
  if (state.status === "preview") {
    return (
      <div className="composer__preview">
        <audio src={state.audioUrl} controls />
        {/* Grouped so mobile can stack the clip over its two buttons. The wrapper
            carries the same 10px gap as the row, so desktop is unchanged. */}
        <div className="composer__preview-actions">
          <button type="button" className="composer__send" onClick={handleSend}>
            Send
          </button>
          <button type="button" className="composer__discard" onClick={handleDiscard}>
            Discard
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="composer__error">
      <span>{state.message}</span>
      <button type="button" onClick={() => setState({ status: "idle" })}>
        Dismiss
      </button>
    </div>
  );
}
