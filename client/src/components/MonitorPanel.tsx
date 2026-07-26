import { useEffect, useState } from "react";
import { useTheme } from "../theme/ThemeContext";
import { DataMonitor, EyeToggle } from "./DataMonitor";
import "./MonitorPanel.css";

const MONITOR_KEY = "trojan-troy-monitor-visible";

interface MonitorPanelProps {
  /** Text the user has sent in this chat — feeds the live "data" visualizer. */
  sentMessages: string[];
}

// The data-monitor visualizer, entered from a toggle in the chat header
// (TitleBar). Extracted from the old per-chat Sidebar, which the chat list
// replaced — see design spec Section 2. The on/off preference for the
// visualizer rows themselves is a global UI setting (same localStorage key as
// before); the DataMonitor content is per-chat, fed this chat's own sent
// messages.
export function MonitorPanel({ sentMessages }: MonitorPanelProps) {
  const { theme } = useTheme();
  const sectionLabel = theme === "apple" ? (label: string) => label : (label: string) => label.toUpperCase();

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
    <div className="monitor-panel">
      <div className="monitor-panel__head">
        <div className="monitor-panel__label">
          {sectionLabel("vizualize ur ")}
          <span className="monitor-panel__data-blur">{sectionLabel("data")}</span>
        </div>
        <EyeToggle on={monitorOn} onToggle={toggleMonitor} />
      </div>
      {rendered && (
        <div className={`monitor-panel__wrap${monitorOn ? "" : " is-poofing"}`}>
          <DataMonitor messages={sentMessages} />
        </div>
      )}
    </div>
  );
}
