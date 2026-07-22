import { useState } from "react";
import { saveDisplayName, restoreFromRecoveryCode, setPin } from "../identity/identity";
import "./identity.css";

// First-launch screen: choose a display name (and optionally an app-lock PIN),
// or restore an existing identity from a recovery code. Writes straight to the
// identity singleton, then hands back to App via onComplete.
export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [name, setName] = useState("");
  const [pin, setPinValue] = useState("");
  const [code, setCode] = useState("");
  const [codePass, setCodePass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveDisplayName(name.trim());
      if (pin) await setPin(pin);
      onComplete();
    } catch {
      setError("Could not save your identity.");
      setBusy(false);
    }
  }

  async function handleRestore() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await restoreFromRecoveryCode(code, codePass || undefined);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid recovery code.");
      setBusy(false);
    }
  }

  return (
    <div className="id-screen">
      <div className="id-card">
        {mode === "create" ? (
          <>
            <h1 className="id-card__title">Set up your identity</h1>
            <p className="id-card__subtitle">
              This creates a long-term key that lives only in this browser — not on any server. Pick a
              display name; you can choose to appear differently, or anonymously, per chat later.
            </p>
            <label className="id-label" htmlFor="setup-name">Display name</label>
            <input
              id="setup-name"
              className="id-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jay"
              maxLength={40}
              autoFocus
            />
            <label className="id-label" htmlFor="setup-pin">App lock PIN (optional)</label>
            <input
              id="setup-pin"
              className="id-input"
              type="password"
              value={pin}
              onChange={(e) => setPinValue(e.target.value)}
              placeholder="Leave blank for no lock"
            />
            <p className="id-hint">
              A PIN encrypts your identity and contacts at rest on this device. If you forget it, you
              can restore from your recovery code.
            </p>
            <button className="id-button" onClick={handleCreate} disabled={!name.trim() || busy}>
              Continue
            </button>
            <button className="id-link" onClick={() => { setMode("restore"); setError(null); }}>
              Restore from a recovery code
            </button>
          </>
        ) : (
          <>
            <h1 className="id-card__title">Restore identity</h1>
            <p className="id-card__subtitle">
              Paste a recovery code exported from another session to bring your identity here.
            </p>
            <label className="id-label" htmlFor="restore-code">Recovery code</label>
            <textarea
              id="restore-code"
              className="id-input"
              rows={4}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
            />
            <label className="id-label" htmlFor="restore-pass">Passphrase (if protected)</label>
            <input
              id="restore-pass"
              className="id-input"
              type="password"
              value={codePass}
              onChange={(e) => setCodePass(e.target.value)}
              placeholder="Leave blank if none"
            />
            <button className="id-button" onClick={handleRestore} disabled={!code.trim() || busy}>
              Restore
            </button>
            <button className="id-link" onClick={() => { setMode("create"); setError(null); }}>
              ← Back to setup
            </button>
          </>
        )}
        {error && <p className="id-error">{error}</p>}
      </div>
    </div>
  );
}
