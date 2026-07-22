import { useEffect, useState, type CSSProperties } from "react";
import { ThemeSwitcher } from "../theme/ThemeSwitcher";
import {
  isLoaded,
  hasPin,
  setPin,
  removePin,
  getAliases,
  addAlias,
  removeAlias,
} from "../identity/identity";
import "./Settings.css";

interface SettingsProps {
  roomCode: string;
  safetyNumber: string;
  ghostMode: boolean;
  onGhostModeChange: (next: boolean) => void;
  contactsOnly: boolean;
  onContactsOnlyChange: (next: boolean) => void;
  onOpenContacts: () => void;
  onLeave: () => void;
  onClose: () => void;
}

const pill: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px solid rgba(143,166,255,0.3)",
  background: "transparent",
  color: "#cdd4f0",
  cursor: "pointer",
  fontSize: 13,
};
const field: CSSProperties = {
  flex: 1,
  padding: "9px 11px",
  borderRadius: 8,
  border: "1px solid rgba(143,166,255,0.25)",
  background: "rgba(0,0,0,0.25)",
  color: "#e8eaf2",
  fontSize: 13,
};
const inlineRow: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };

export function Settings({
  roomCode,
  safetyNumber,
  ghostMode,
  onGhostModeChange,
  contactsOnly,
  onContactsOnlyChange,
  onOpenContacts,
  onLeave,
  onClose,
}: SettingsProps) {
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const [pinDraft, setPinDraft] = useState("");
  const [aliasDraft, setAliasDraft] = useState("");

  const identityReady = isLoaded();
  const pinSet = identityReady && hasPin();
  const aliases = identityReady ? getAliases() : [];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSetPin() {
    if (!pinDraft) return;
    await setPin(pinDraft);
    setPinDraft("");
    refresh();
  }
  async function handleRemovePin() {
    await removePin();
    refresh();
  }
  async function handleAddAlias() {
    const value = aliasDraft.trim();
    if (!value) return;
    await addAlias(value);
    setAliasDraft("");
    refresh();
  }
  async function handleRemoveAlias(alias: string) {
    await removeAlias(alias);
    refresh();
  }

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
            When on, your peer never sees a "read" receipt, and your typing/recording activity isn't
            broadcast — they'll still see "delivered."
          </p>

          <div className="settings__row">
            <span className="settings__row-label">Contacts-only mode</span>
            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={contactsOnly}
                onChange={(event) => onContactsOnlyChange(event.target.checked)}
              />
              <span className="settings__toggle-track" />
            </label>
          </div>
          <p className="settings__about-text">
            When on, only people whose identity key you've already verified can connect — unknown
            peers are refused before any message is exchanged.
          </p>

          {identityReady && (
            <>
              <div className="settings__row">
                <span className="settings__row-label">App lock (PIN)</span>
                {pinSet ? (
                  <button style={pill} onClick={handleRemovePin}>
                    Remove
                  </button>
                ) : (
                  <span className="settings__row-value">Off</span>
                )}
              </div>
              {!pinSet && (
                <div style={inlineRow}>
                  <input
                    style={field}
                    type="password"
                    value={pinDraft}
                    placeholder="Set a PIN to encrypt at rest"
                    onChange={(e) => setPinDraft(e.target.value)}
                  />
                  <button style={pill} disabled={!pinDraft} onClick={handleSetPin}>
                    Set
                  </button>
                </div>
              )}

              <div className="settings__row" style={{ marginTop: 14 }}>
                <span className="settings__row-label">Appear-as names</span>
              </div>
              {aliases.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {aliases.map((a) => (
                    <span key={a} style={{ ...pill, display: "inline-flex", gap: 6, alignItems: "center" }}>
                      {a}
                      <button
                        onClick={() => handleRemoveAlias(a)}
                        aria-label={`Remove ${a}`}
                        style={{ background: "none", border: "none", color: "#9aa3c0", cursor: "pointer", padding: 0 }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div style={inlineRow}>
                <input
                  style={field}
                  value={aliasDraft}
                  placeholder="Add an alias to appear as"
                  maxLength={40}
                  onChange={(e) => setAliasDraft(e.target.value)}
                />
                <button style={pill} disabled={!aliasDraft.trim()} onClick={handleAddAlias}>
                  Add
                </button>
              </div>

              <button style={{ ...pill, width: "100%", marginTop: 14, padding: "10px" }} onClick={onOpenContacts}>
                Manage contacts &amp; backup
              </button>
            </>
          )}
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
