import { useEffect } from "react";
import { avatarSrc } from "../profiles/avatar";
import type { PeerProfile } from "../profiles/profileModel";
import "./ProfileCard.css";

interface ProfileCardProps {
  card: PeerProfile;
  /** On-screen box of the avatar that was clicked. */
  anchor: DOMRect;
  onClose: () => void;
}

const CARD_WIDTH = 220;

export function ProfileCard({ card, anchor, onClose }: ProfileCardProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Sit the card just above the clicked avatar, clamped to the viewport.
  const left = Math.min(Math.max(anchor.left - 8, 8), window.innerWidth - CARD_WIDTH - 8);
  const bottom = window.innerHeight - anchor.top + 8;

  return (
    <div className="profile-card__backdrop" onClick={onClose}>
      <div
        className="profile-card"
        style={{ left, bottom, width: CARD_WIDTH }}
        onClick={(event) => event.stopPropagation()}
      >
        <img className="profile-card__avatar" src={avatarSrc(card.avatar)} alt="" />
        <div className="profile-card__name">{card.name}</div>
        {card.device && (
          <div className="profile-card__device">
            <span className="profile-card__device-icon" aria-hidden="true">
              {card.device === "phone" ? "📱" : "🖥️"}
            </span>
            On {card.device === "phone" ? "phone" : "computer"}
          </div>
        )}
      </div>
    </div>
  );
}
