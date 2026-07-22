import { useEffect } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";
import "./Settings.css";

interface SettingsProps {
  roomCode: string;
  safetyNumber: string;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  shareProfile: boolean;
  onShareProfileChange: (next: boolean) => void;
  onLeave: () => void;
  onClose: () => void;
}

export function Settings({
  roomCode,
  safetyNumber,
  ghostMode,
  onGhostModeChange,
  shareProfile,
  onShareProfileChange,
  onLeave,
  onClose,
}: SettingsProps) {
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
          <div className="settings__section-label">Privacy</div>
          <div className="settings__row">
            <span className="settings__row-label">Ghost mode</span>
            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={ghostMode}
                onChange={(event) => onGhostModeChange(event.target.checked)}
              />
              <span className="settings__toggle-track" />
            </label>
          </div>
          <p className="settings__about-text">
            When on, your peer never sees a "read" receipt for messages you open — they'll still see
            "delivered."
          </p>
          <div className="settings__row">
            <span className="settings__row-label">Show my name &amp; photo</span>
            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={shareProfile}
                onChange={(event) => onShareProfileChange(event.target.checked)}
              />
              <span className="settings__toggle-track" />
            </label>
          </div>
          <p className="settings__about-text">
            Off by default. When on with a named profile active, only the person you're chatting with
            sees your name and photo — sent encrypted, never the relay.
          </p>
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
