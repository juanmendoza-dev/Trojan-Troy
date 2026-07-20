import { type FormEvent, useState } from "react";
import { VoiceRecorder } from "../screens/VoiceRecorder";
import "./Composer.css";

interface ComposerProps {
  onSend: (text: string) => void;
  onSendVoice: (blob: Blob, mimeType: string) => void;
}

const SENT_ANIMATION_MS = 300;

export function Composer({ onSend, onSendVoice }: ComposerProps) {
  const [value, setValue] = useState("");
  const [justSent, setJustSent] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    onSend(text);
    setValue("");
    setJustSent(true);
    setTimeout(() => setJustSent(false), SENT_ANIMATION_MS);
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className={`composer__input-wrap${justSent ? " composer__input-wrap--sent" : ""}`}>
        <input
          className="composer__input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Message — encrypted end-to-end"
          autoComplete="off"
        />
        <span className="composer__caret" />
      </div>
      <VoiceRecorder onSend={onSendVoice} />
      <button className="composer__send-button" type="submit" aria-label="Send">
        ↑
      </button>
    </form>
  );
}
