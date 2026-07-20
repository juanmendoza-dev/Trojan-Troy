import { useRef, useState } from "react";
import "./VoiceMessageBubble.css";

interface VoiceMessageBubbleProps {
  from: "me" | "peer";
  audioUrl: string;
  durationLabel: string;
}

const BAR_HEIGHTS = [10, 20, 14, 24, 12, 22, 9, 18, 13, 21];

export function VoiceMessageBubble({ from, audioUrl, durationLabel }: VoiceMessageBubbleProps) {
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
      <div className="voice-bubble">
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
    </div>
  );
}
