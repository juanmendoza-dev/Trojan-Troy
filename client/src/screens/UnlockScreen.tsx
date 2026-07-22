import { useState } from "react";
import { unlock } from "../identity/identity";
import "./identity.css";

// Shown on launch (or after an idle re-lock) when the identity vault is
// PIN-protected. Decrypts the vault into memory on the correct PIN.
export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    if (!pin || busy) return;
    setBusy(true);
    setError(null);
    const ok = await unlock(pin);
    if (ok) {
      onUnlocked();
      return;
    }
    setError("Wrong PIN. Try again, or restore from your recovery code on a fresh setup.");
    setBusy(false);
    setPin("");
  }

  return (
    <div className="id-screen">
      <div className="id-card">
        <h1 className="id-card__title">Unlock</h1>
        <p className="id-card__subtitle">
          Enter your PIN to decrypt your identity and contacts on this device.
        </p>
        <label className="id-label" htmlFor="unlock-pin">PIN</label>
        <input
          id="unlock-pin"
          className="id-input"
          type="password"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleUnlock();
          }}
        />
        <button className="id-button" onClick={handleUnlock} disabled={!pin || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
        {error && <p className="id-error">{error}</p>}
      </div>
    </div>
  );
}
