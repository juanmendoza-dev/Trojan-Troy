import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./Icon";
import { DataMonitor, EyeToggle } from "./DataMonitor";
import { RainbowText } from "./RainbowText";
import "./Sidebar.css";

const MONITOR_KEY = "trojan-troy-monitor-visible";

interface SidebarProps {
  roomCode: string;
  onNewChat: () => void;
  /** Text the user has sent — feeds the live "data" (plaintext → ciphertext) visualizer. */
  sentMessages?: string[];
  /** Whether the room code is masked (shared with the title bar). */
  roomHidden: boolean;
  onToggleRoomHidden: () => void;
}

export function Sidebar({
  roomCode,
  onNewChat,
  sentMessages = [],
  roomHidden,
  onToggleRoomHidden,
}: SidebarProps) {
  const { theme } = useTheme();
  const sectionLabel = theme === "apple" ? (label: string) => label : (label: string) => label.toUpperCase();

  // Show/hide the visualizer monitor (remembered across sessions). `rendered`
  // keeps it mounted through the poof-out animation before it unmounts.
  const [monitorOn, setMonitorOn] = useState(() => localStorage.getItem(MONITOR_KEY) !== "false");
  const [rendered, setRendered] = useState(monitorOn);
  useEffect(() => {
    if (monitorOn) {
      setRendered(true);
      return;
    }
    const t = window.setTimeout(() => setRendered(false), 550);
    return () => window.clearTimeout(t);
  }, [monitorOn]);
  const toggleMonitor = () =>
    setMonitorOn((v) => {
      const next = !v;
      localStorage.setItem(MONITOR_KEY, String(next));
      return next;
    });

  return (
    <div className="sidebar">
      <button className="sidebar__new-chat" onClick={onNewChat}>
        <Icon name="plus" size={16} strokeWidth={2.25} />
        New chat
        {theme !== "apple" && <span className="sidebar__sheen" />}
      </button>

      <div className="sidebar__active-card">
        <div className="sidebar__active-card-top">
          <span className="sidebar__room">
            <span className="sidebar__room-code">
              {roomHidden ? roomCode.replace(/[^-]/g, "•") : roomCode}
            </span>
            <button
              type="button"
              className="sidebar__room-eye"
              onClick={onToggleRoomHidden}
              aria-label={roomHidden ? "Show room code" : "Hide room code"}
              aria-pressed={roomHidden}
            >
              <Icon name={roomHidden ? "eye-off" : "eye"} size={14} />
            </button>
          </span>
          <span className="sidebar__verified-label">
            <span className="sidebar__verified-dot" />
            {theme === "apple" ? "Verified" : "verified"}
          </span>
        </div>
      </div>

      <div className="sidebar__monitor-head">
        <div className="sidebar__label">
          {sectionLabel("vizualize ur ")}
          <span className="sidebar__data-blur">{sectionLabel("data")}</span>
        </div>
        <EyeToggle on={monitorOn} onToggle={toggleMonitor} />
      </div>
      {rendered && (
        <div className={`data-monitor-wrap${monitorOn ? "" : " is-poofing"}`}>
          <span className="data-monitor-wrap__ring" aria-hidden="true" />
          <DataMonitor messages={sentMessages} />
        </div>
      )}

      <div className="sidebar__footer">
        <RainbowText text="ur keys never leave this device" />
      </div>
    </div>
  );
}
