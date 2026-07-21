import { useRef, useState } from "react";
import { STATUS_TICKS, type MessageStatus } from "../protocol/messageStatus";
import "./VoiceMessageBubble.css";

interface VoiceMessageBubbleProps {
  from: "me" | "peer";
  audioUrl: string;
  durationLabel: string;
  status?: MessageStatus;
  delayMs?: number;
}

const BAR_HEIGHTS = [10, 20, 14, 24, 12, 22, 9, 18, 13, 21];

export function VoiceMessageBubble({
  from,
  audioUrl,
  durationLabel,
  status,
  delayMs = 0,
}: VoiceMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  return (
    <div className={from === "me" ? "message-row message-row--outgoing" : "message-row message-row--incoming"}>
      <div className="voice-bubble" style={{ animationDelay: `${delayMs}ms` }}>
        <audio
          ref={audioRef}
          src={audioUrl}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
        <button className="voice-bubble__play" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="voice-bubble__waveform" data-playing={playing}>
          {BAR_HEIGHTS.map((height, index) => (
            <span
              key={index}
              className="voice-bubble__bar"
              style={{ height, animationDelay: `${index * 0.15}s` }}
            />
          ))}
        </div>
        <span className="voice-bubble__duration">{durationLabel}</span>
      </div>
      {status && <span className={`message-status message-status--${status}`}>{STATUS_TICKS[status]}</span>}
    </div>
  );
}
