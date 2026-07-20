import { useTheme } from "../theme/ThemeContext";
import "./TitleBar.css";

interface TitleBarProps {
  roomCode: string;
}

export function TitleBar({ roomCode }: TitleBarProps) {
  const { theme } = useTheme();
  const isApple = theme === "apple";

  return (
    <div className="title-bar">
      <div className="title-bar__wordmark">{isApple ? "Trojan Troy" : "TROJAN·TROY"}</div>
      <div className="title-bar__room">
        Room <span className="title-bar__room-code">{roomCode}</span>
      </div>
      <div className="title-bar__verified">
        <span className="title-bar__verified-dot" />
        {isApple ? "Verified · End-to-end encrypted" : "Verified · E2E encrypted"}
      </div>
    </div>
  );
}
