// client/src/screens/HandshakeJourney.tsx
import type { ReactNode } from "react";
import { AmbientOrbs } from "../components/AmbientOrbs";
import { Crossfade } from "../components/Crossfade";
import "./HandshakeJourney.css";

interface HandshakeJourneyProps {
  activeKey: string;
  children: ReactNode;
}

export function HandshakeJourney({ activeKey, children }: HandshakeJourneyProps) {
  return (
    <div className="handshake-journey" data-active-screen={activeKey}>
      <AmbientOrbs />
      <Crossfade activeKey={activeKey}>{children}</Crossfade>
    </div>
  );
}
