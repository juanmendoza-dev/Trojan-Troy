import { useTheme } from "../theme/ThemeContext";
import { avatarSrc } from "../profiles/avatar";
import { Icon } from "./Icon";
import type { PeerProfile } from "../profiles/profileModel";
import "./TitleBar.css";

interface TitleBarProps {
  roomCode: string;
  peerProfile?: PeerProfile | null;
  onOpenSettings: () => void;
  /** Mask the room code. */
  roomHidden: boolean;
  onToggleRoomHidden: () => void;
  /** Whether the MonitorPanel strip is open below this bar. */
  monitorOpen: boolean;
  onToggleMonitor: () => void;
}

export function TitleBar({
  roomCode,
  peerProfile,
  onOpenSettings,
  roomHidden,
  onToggleRoomHidden,
  monitorOpen,
  onToggleMonitor,
}: TitleBarProps) {
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
        <button
          type="button"
          className="title-bar__room-eye"
          onClick={onToggleRoomHidden}
          aria-label={roomHidden ? "Show room code" : "Hide room code"}
          aria-pressed={roomHidden}
        >
          <Icon name={roomHidden ? "eye-off" : "eye"} size={14} />
        </button>
      </div>
      <div className="title-bar__verified">
        <span className="title-bar__verified-dot" />
        {isApple ? "Verified · End-to-end encrypted" : "Verified · E2E encrypted"}
      </div>
      <button
        type="button"
        className="title-bar__settings-button"
        onClick={onToggleMonitor}
        aria-label={monitorOpen ? "Hide data monitor" : "Show data monitor"}
        aria-pressed={monitorOpen}
      >
        <Icon name="activity" size={17} />
      </button>
      <button className="title-bar__settings-button" onClick={onOpenSettings} aria-label="Settings">
        <Icon name="settings" size={17} />
      </button>
    </div>
  );
}
