import { useEffect } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";
import { Icon } from "./Icon";
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
            <Icon name="x" size={16} />
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
            Trojan Troy encrypts every message and voice note end-to-end — the relay only ever sees
            padded ciphertext, and your keys never leave this device. The connection keys are agreed
            with a hybrid post-quantum exchange (X25519 + ML-KEM-768), so traffic recorded today
            stays sealed even against a future quantum computer. Every message then gets its own key,
            discarded right after (a Double Ratchet), so a stolen key can't unlock past messages — and
            about every thirty seconds the connection quietly re-secures itself with fresh
            post-quantum key material, so recovery from a compromise doesn't rest on classical
            cryptography either. Even the routing details are sealed: the relay can't see which
            messages belong to the same run, or tell a text from a voice note from a read receipt.
            The app also blends in a steady stream of decoy traffic, so the relay can tell a chat is
            happening but not its rhythm — when you're typing, pausing, or sitting idle — and never
            what's said. It can still count how many packets cross it. The safety number above is
            tied to this exact session; if it ever changes unexpectedly, don't trust the connection.
          </p>
        </div>

        <button className="settings__leave-button" onClick={onLeave}>
          Leave chat
        </button>
      </div>
    </div>
  );
}
