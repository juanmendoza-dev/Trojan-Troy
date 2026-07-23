import { useTheme } from "../theme/ThemeContext";
import { avatarSrc } from "../profiles/avatar";
import { Icon } from "./Icon";
import type { PeerProfile } from "../profiles/profileModel";
import "./TitleBar.css";

interface TitleBarProps {
  roomCode: string;
  peerProfile?: PeerProfile | null;
  onOpenSettings: () => void;
  /** Mask the room code (driven by the sidebar's eye toggle). */
  roomHidden?: boolean;
}

export function TitleBar({ roomCode, peerProfile, onOpenSettings, roomHidden }: TitleBarProps) {
  const { theme } = useTheme();
  const isApple = theme === "apple";

  return (
    <div className="title-bar">
      <div className="title-bar__wordmark">
        Trojan Troy<span className="title-bar__wordmark-dot">.</span>
      </div>
      {peerProfile && (
        <div className="title-bar__peer">
          <img className="title-bar__peer-avatar" src={avatarSrc(peerProfile.avatar)} alt="" />
          <span className="title-bar__peer-name">{peerProfile.name}</span>
        </div>
      )}
      <div className="title-bar__room">
        Room <span className="title-bar__room-code">{roomHidden ? roomCode.replace(/[^-]/g, "•") : roomCode}</span>
      </div>
      <div className="title-bar__verified">
        <span className="title-bar__verified-dot" />
        {isApple ? "Verified · End-to-end encrypted" : "Verified · E2E encrypted"}
      </div>
      <button className="title-bar__settings-button" onClick={onOpenSettings} aria-label="Settings">
        <Icon name="settings" size={17} />
      </button>
    </div>
  );
}
