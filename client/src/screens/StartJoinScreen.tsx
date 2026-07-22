import { useEffect, useRef, useState, type FormEvent } from "react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { ConnectingBar, type ConnectStatus } from "./ConnectingBar";
import { SECURITY_TICKER_TEXT } from "./securityTicker";
import { ProfileButton } from "../components/ProfileButton";
import type { ActiveProfile } from "../profiles/profileModel";
import "./StartJoinScreen.css";

interface StartJoinScreenProps {
  onStart: () => void;
  onJoin: (code: string) => void;
  connectStatus: ConnectStatus;
  initialCode?: string;
  activeProfile: ActiveProfile;
  onOpenProfiles: () => void;
}

export function StartJoinScreen({
  onStart,
  onJoin,
  connectStatus,
  initialCode,
  activeProfile,
  onOpenProfiles,
}: StartJoinScreenProps) {
  const [code, setCode] = useState(initialCode ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = connectStatus !== "idle";

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
    onStart();
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || busy) return;
    onJoin(trimmed);
  };

  const joinDisabled = code.trim().length === 0 || busy;

  return (
    <div className="start-join-screen">
      <AmbientOrbs />

      <div className="start-join-screen__badge">
        <span className="start-join-screen__badge-dot" />
        Secure channel ready
      </div>

      <ProfileButton active={activeProfile} onClick={onOpenProfiles} />

      <div className="start-join-screen__hero">
        <h1 className="start-join-screen__wordmark">
          Trojan
          <br />
          Troy<span className="start-join-screen__period">.</span>
        </h1>
        <p className="start-join-screen__tagline">End-to-end encrypted. No accounts. No trace.</p>

        <div className="start-join-screen__card">
          <div className="start-join-screen__form" data-busy={busy}>
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
