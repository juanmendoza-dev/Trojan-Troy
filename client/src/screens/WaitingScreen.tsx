import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { buildInviteLink } from "../net/inviteLink";
import { SECURITY_TICKER_TEXT } from "./securityTicker";
import "./WaitingScreen.css";

interface WaitingScreenProps {
  roomCode: string;
  onCancel: () => void;
}

const COPY_REVERT_MS = 1500;

export function WaitingScreen({ roomCode, onCancel }: WaitingScreenProps) {
  const inviteLink = useMemo(
    () => buildInviteLink(window.location.origin, window.location.pathname, roomCode),
    [roomCode]
  );

  const [copied, setCopied] = useState<null | "code" | "link">(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();

  // Clear the "Copied ✓" revert timer on unmount (matches Crossfade's pattern).
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  async function handleCopy(text: string, which: "code" | "link") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard blocked (e.g. an insecure context) — leave the button as-is.
      return;
    }
    setCopied(which);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), COPY_REVERT_MS);
  }

  return (
    <div className="waiting-screen">
      <AmbientOrbs />

      <div className="waiting-screen__content">
        <div className="waiting-screen__top-row">
          <div className="waiting-screen__status">
            <span className="waiting-screen__status-dot" />
            BROADCASTING INVITE
          </div>
          <button type="button" className="waiting-screen__cancel" onClick={onCancel}>
            ✕ Cancel
          </button>
        </div>

        <div className="waiting-screen__center">
          <div className="waiting-screen__radar">
            <span className="waiting-screen__ring" style={{ animationDelay: "0s" }} />
            <span className="waiting-screen__ring" style={{ animationDelay: "1s" }} />
            <span className="waiting-screen__ring" style={{ animationDelay: "2s" }} />
            <div className="waiting-screen__code">{roomCode}</div>
          </div>

          <div className="waiting-screen__subwait">
            <span className="waiting-screen__subwait-dot" />
            waiting for your friend to join…
          </div>

          <div className="waiting-screen__actions">
            <button
              type="button"
              className={`waiting-screen__pill waiting-screen__pill--filled${
                copied === "code" ? " is-copied" : ""
              }`}
              onClick={() => handleCopy(roomCode, "code")}
            >
              {copied === "code" ? "Copied ✓" : "Copy code"}
            </button>
            <button
              type="button"
              className={`waiting-screen__pill waiting-screen__pill--outline${
                copied === "link" ? " is-copied" : ""
              }`}
              onClick={() => handleCopy(inviteLink, "link")}
            >
              {copied === "link" ? "Copied ✓" : "Copy link"}
            </button>
          </div>

          <div className="waiting-screen__qr-card">
            <QRCodeSVG
              value={inviteLink}
              size={132}
              bgColor="transparent"
              fgColor="#8FA6FF"
              level="M"
              marginSize={0}
            />
            <span className="waiting-screen__qr-caption">SCAN TO JOIN</span>
          </div>
        </div>

        <div className="waiting-screen__bottom">
          <p className="waiting-screen__reassurance">
            Send this to the one person you want to talk to. Keys never leave this device.
          </p>
        </div>
      </div>

      <div className="waiting-screen__marquee">
        <div className="waiting-screen__marquee-track">
          <span>{SECURITY_TICKER_TEXT.repeat(2)}</span>
          <span>{SECURITY_TICKER_TEXT.repeat(2)}</span>
        </div>
      </div>

      <div className="waiting-screen__hairline" />
    </div>
  );
}
