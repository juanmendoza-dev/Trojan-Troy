import { useState } from "react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { ERROR_SCENARIOS, pickHeadline, type ErrorScenario } from "./errorScenario";
import "./ErrorScreen.css";

interface ErrorScreenProps {
  scenario: ErrorScenario;
  /** Tear everything down and go back to the start screen. Always shown. */
  onNewChat: () => void;
  /** When set, a "Try again" button replays the failed action. Omitted for
   *  scenarios with no clean in-place retry (peer left / handshake failed). */
  onRetry?: () => void;
}

// A stranded-on-a-desert-island error screen, ported from the Fable handoff
// ("Trojan Troy - Error Screen.html"). Standalone Iris-Glass shell + shared
// AmbientOrbs, like WaitingScreen/StartJoinScreen.
export function ErrorScreen({ scenario, onNewChat, onRetry }: ErrorScreenProps) {
  // Pick one headline for the life of the screen (not re-rolled every render).
  const [headline] = useState(() => pickHeadline(scenario, Math.random()));
  const { label } = ERROR_SCENARIOS[scenario];

  return (
    <div className="error-screen">
      <AmbientOrbs />

      <div className="error-screen__signature">love from miami</div>

      <div className="error-screen__card" role="alert">
        <svg
          className="error-screen__scene"
          viewBox="0 0 440 190"
          fill="none"
          stroke="#8FA6FF"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* sea horizon, drifting */}
          <g className="error-screen__sea">
            <path d="M 24 128 H 200 M 214 128 H 300 M 312 128 H 424" opacity={0.55} />
            <path d="M 60 137 h 34 M 250 137 h 26 M 350 136 h 40" opacity={0.3} />
          </g>
          {/* sand line */}
          <path d="M 12 168 C 90 158, 200 176, 290 168 S 410 160, 432 166" opacity={0.7} />
          {/* palm: trunk fixed, fronds sway */}
          <path d="M 88 166 C 84 140, 78 108, 84 74" />
          <path d="M 96 166 C 93 138, 88 106, 90 76" />
          <path d="M 86 158 h 8 M 84 146 h 8 M 82 132 h 8" opacity={0.45} />
          <g className="error-screen__palm">
            <path d="M 87 75 C 68 66, 46 66, 30 78" />
            <path d="M 87 75 C 72 58, 52 52, 34 56" />
            <path d="M 87 75 C 88 54, 80 38, 64 30" />
            <path d="M 87 75 C 100 56, 116 48, 136 50" />
            <path d="M 87 75 C 106 66, 126 68, 140 82" />
            <circle cx="80" cy="82" r="4.5" />
            <circle cx="94" cy="84" r="4.5" />
          </g>
          {/* lone coconut on the sand */}
          <circle cx="130" cy="162" r="6" />
          <path d="M 127 159 a 4 4 0 0 1 6 0" opacity={0.5} />
          {/* deckchair: reclined back rail + seat rail, slats, two legs */}
          <g>
            <path d="M 234 116 L 254 148" />
            <path d="M 254 148 L 296 156" />
            <path d="M 238 122.5 l 8 -5 M 242.5 129.5 l 8 -5 M 247 136.5 l 8 -5 M 251.5 143.5 l 8 -5" opacity={0.7} />
            <path d="M 263 149.7 l 1.5 -8 M 272 151.4 l 1.5 -8 M 281 153.1 l 1.5 -8" opacity={0.7} />
            <path d="M 258 148.8 L 250 168 M 288 154.5 L 294 168" />
          </g>
          {/* message in a bottle, half-buried */}
          <g transform="translate(0 4) rotate(-24 352 158)">
            <path
              d="M 336 152 h 24 a 8 8 0 0 1 8 8 v 0 a 8 8 0 0 1 -8 8 h -24 a 4 4 0 0 1 -4 -4 v -8 a 4 4 0 0 1 4 -4 Z"
              fill="rgba(143,166,255,0.07)"
            />
            <path d="M 332 156 h -7 v 8 h 7" />
            <path d="M 344 156 v 8 M 350 156 v 8" opacity={0.5} />
          </g>
          <path d="M 334 170 C 346 165, 364 165, 374 171" opacity={0.8} />
          {/* crab: scuttles across, legs jitter */}
          <g className="error-screen__crab">
            <g className="error-screen__crab-legs">
              <ellipse cx="188" cy="160" rx="9" ry="6" />
              <path d="M 180 164 l -6 5 M 184 166 l -4 6 M 192 166 l 4 6 M 196 164 l 6 5" opacity={0.7} />
              <path d="M 181 154 c -5 -4, -9 -3, -10 1 M 195 154 c 5 -4, 9 -3, 10 1" />
              <circle cx="185" cy="157" r="0.8" fill="#8FA6FF" stroke="none" />
              <circle cx="191" cy="157" r="0.8" fill="#8FA6FF" stroke="none" />
            </g>
          </g>
        </svg>

        <div className="error-screen__label">{label}</div>
        <h1 className="error-screen__headline">{headline}</h1>
        <p className="error-screen__subcopy">Nothing between you but ciphertext now.</p>

        <div className="error-screen__actions">
          <button
            type="button"
            className="error-screen__btn error-screen__btn--primary"
            onClick={onNewChat}
          >
            Start a new chat
          </button>
          {onRetry && (
            <button
              type="button"
              className="error-screen__btn error-screen__btn--ghost"
              onClick={onRetry}
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
