import { useEffect, useRef, useState, type FormEvent } from "react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { ConnectingBar, type ConnectStatus } from "./ConnectingBar";
import { SECURITY_TICKER_TEXT } from "./securityTicker";
import "./StartJoinScreen.css";

interface StartJoinScreenProps {
  onStart: (presentedName: string | null) => void;
  onJoin: (code: string, presentedName: string | null) => void;
  connectStatus: ConnectStatus;
  initialCode?: string;
  displayName?: string;
  aliases?: string[];
}

export function StartJoinScreen({
  onStart,
  onJoin,
  connectStatus,
  initialCode,
  displayName = "You",
  aliases = [],
}: StartJoinScreenProps) {
  const [code, setCode] = useState(initialCode ?? "");
  const [presentAs, setPresentAs] = useState("default");
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = connectStatus !== "idle";

  // Resolve the "appear as" picker to the name we'll send in the identity
  // envelope: the default display name, a saved alias, or null (anonymous).
  function resolvePresentedName(): string | null {
    if (presentAs === "anon") return null;
    if (presentAs.startsWith("alias:")) return presentAs.slice("alias:".length);
    return displayName;
  }

  // When we arrive from an invite link, prefill the code and highlight it so
  // the user just has to hit Join (rather than auto-connecting on page load).
  useEffect(() => {
    if (initialCode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [initialCode]);

  const handleStart = () => {
    if (busy) return;
    onStart(resolvePresentedName());
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || busy) return;
    onJoin(trimmed, resolvePresentedName());
  };

  const joinDisabled = code.trim().length === 0 || busy;

  return (
    <div className="start-join-screen">
      <AmbientOrbs />

      <div className="start-join-screen__badge">
        <span className="start-join-screen__badge-dot" />
        Secure channel ready
      </div>

      <div className="start-join-screen__hero">
        <h1 className="start-join-screen__wordmark">
          Trojan
          <br />
          Troy<span className="start-join-screen__period">.</span>
        </h1>
        <p className="start-join-screen__tagline">End-to-end encrypted. No accounts. No trace.</p>

        <div className="start-join-screen__card">
          <div className="start-join-screen__form" data-busy={busy}>
            <label
              style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14, textAlign: "left" }}
            >
              <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8FA6FF" }}>
                Appear to them as
              </span>
              <select
                value={presentAs}
                onChange={(event) => setPresentAs(event.target.value)}
                disabled={busy}
                style={{
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(143,166,255,0.28)",
                  background: "rgba(0,0,0,0.28)",
                  color: "#e8eaf2",
                  fontSize: 14,
                }}
              >
                <option value="default">{displayName}</option>
                {aliases.map((alias) => (
                  <option key={alias} value={`alias:${alias}`}>
                    {alias}
                  </option>
                ))}
                <option value="anon">Anonymous</option>
              </select>
            </label>

            <button
              type="button"
              className="start-join-screen__start"
              onClick={handleStart}
              disabled={busy}
            >
              Start a chat
            </button>

            <div className="start-join-screen__divider">
              <span className="start-join-screen__divider-line" />
              <span className="start-join-screen__divider-label">or join</span>
              <span className="start-join-screen__divider-line" />
            </div>

            <form className="start-join-screen__joinrow" onSubmit={handleJoin}>
              <input
                ref={inputRef}
                className="start-join-screen__input"
                name="roomCode"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="ROOM-CODE"
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
              />
              <button type="submit" className="start-join-screen__join" disabled={joinDisabled}>
                Join
              </button>
            </form>
          </div>

          <ConnectingBar status={connectStatus} />
        </div>
      </div>

      <div className="start-join-screen__marquee">
        <div className="start-join-screen__marquee-track">
          <span>{SECURITY_TICKER_TEXT.repeat(2)}</span>
          <span>{SECURITY_TICKER_TEXT.repeat(2)}</span>
        </div>
      </div>

      <div className="start-join-screen__hairline" />
    </div>
  );
}
