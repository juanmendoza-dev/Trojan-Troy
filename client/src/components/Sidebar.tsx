import { useTheme } from "../theme/ThemeContext";
import "./Sidebar.css";

interface SidebarProps {
  roomCode: string;
  onNewChat: () => void;
}

export function Sidebar({ roomCode, onNewChat }: SidebarProps) {
  const { theme } = useTheme();
  const sectionLabel = theme === "apple" ? (label: string) => label : (label: string) => label.toUpperCase();

  return (
    <div className="sidebar">
      <button className="sidebar__new-chat" onClick={onNewChat}>
        {theme === "apple" ? "New chat" : "+ New chat"}
        {theme !== "apple" && <span className="sidebar__sheen" />}
      </button>
      <div className="sidebar__label">{sectionLabel("Active")}</div>
      <div className="sidebar__active-card">
        <div className="sidebar__active-card-top">
          <span className="sidebar__room-code">{roomCode}</span>
          <span className="sidebar__verified-label">{theme === "apple" ? "Verified" : "● verified"}</span>
        </div>
        <span className="sidebar__subline">Voice message · 0:23</span>
      </div>
      <div className="sidebar__label">{sectionLabel("Contacts")}</div>
      <div className="sidebar__contacts-placeholder">
        Persistent contacts arrive with long-term identity keys. Coming soon.
      </div>
      <div className="sidebar__footer">Your keys never leave this device.</div>
    </div>
  );
}
