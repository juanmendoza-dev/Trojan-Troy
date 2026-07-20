import { useEffect } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";
import "./Settings.css";

interface SettingsProps {
  roomCode: string;
  safetyNumber: string;
  onLeave: () => void;
  onClose: () => void;
}

export function Settings({ roomCode, safetyNumber, onLeave, onClose }: SettingsProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="settings__backdrop" onClick={onClose}>
      <div className="settings__panel" onClick={(event) => event.stopPropagation()}>
        <div className="settings__header">
          <span className="settings__title">Settings</span>
          <button className="settings__close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className="settings__section">
          <div className="settings__section-label">Theme</div>
          <ThemeSwitcher />
        </div>

        <div className="settings__section">
          <div className="settings__section-label">Session</div>
          <div className="settings__row">
            <span className="settings__row-label">Room code</span>
            <span className="settings__row-value">{roomCode}</span>
          </div>
          <div className="settings__row">
            <span className="settings__row-label">Safety number</span>
            <span className="settings__row-value settings__row-value--mono">{safetyNumber}</span>
          </div>
          <div className="settings__row">
            <span className="settings__row-label">Status</span>
            <span className="settings__row-value">Connected</span>
          </div>
        </div>

        <div className="settings__section">
          <div className="settings__section-label">About</div>
          <p className="settings__about-text">
            Trojan Troy encrypts every message and voice note end-to-end. The relay only ever sees
            ciphertext — your keys never leave this device. The safety number above verifies this
            session; if it ever changes unexpectedly, don't trust the connection.
          </p>
        </div>

        <button className="settings__leave-button" onClick={onLeave}>
          Leave chat
        </button>
      </div>
    </div>
  );
}
