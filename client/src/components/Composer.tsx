import { type FormEvent, useEffect, useState } from "react";
import { VoiceRecorder } from "../screens/VoiceRecorder";
import "./Composer.css";

interface ComposerProps {
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
  onRecordingChange?: (isRecording: boolean) => void;
}

const SENT_ANIMATION_MS = 300;

export function Composer({ onSend, onSendVoice, onTypingChange, onRecordingChange }: ComposerProps) {
  const [value, setValue] = useState("");
  const [justSent, setJustSent] = useState(false);

  useEffect(() => {
    if (!justSent) return;
    const timer = setTimeout(() => setJustSent(false), SENT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [justSent]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setJustSent(true);
    onTypingChange?.(false);
  }

  function handleChange(next: string) {
    setValue(next);
    onTypingChange?.(next.trim().length > 0);
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className={`composer__input-wrap${justSent ? " composer__input-wrap--sent" : ""}`}>
        <input
          className="composer__input"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={() => onTypingChange?.(false)}
          placeholder="Message — encrypted end-to-end"
          autoComplete="off"
        />
      </div>
      <VoiceRecorder onSend={onSendVoice} onRecordingChange={onRecordingChange} />
      <button className="composer__send-button" type="submit" aria-label="Send">
        ↑
      </button>
    </form>
  );
}
