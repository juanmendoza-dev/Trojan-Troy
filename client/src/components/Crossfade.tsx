// client/src/components/Crossfade.tsx
import { useEffect, useState, type ReactNode } from "react";
import { withActiveKey, settled, type CrossfadeState } from "./crossfadeState";
import "./Crossfade.css";

interface CrossfadeProps {
  activeKey: string;
  durationMs?: number;
  children: ReactNode;
}

export function Crossfade({ activeKey, durationMs = 350, children }: CrossfadeProps) {
  const [state, setState] = useState<CrossfadeState>({
    current: { key: activeKey, node: children },
    exiting: null,
  });

  useEffect(() => {
    setState((prev) => withActiveKey(prev, activeKey, children));
  }, [activeKey, children]);

  useEffect(() => {
    if (!state.exiting) return;
    const timer = setTimeout(() => setState((prev) => settled(prev)), durationMs);
    return () => clearTimeout(timer);
  }, [state.exiting, durationMs]);

  return (
    <div className="crossfade">
      {state.exiting && (
        <div key={state.exiting.key} className="crossfade__layer crossfade__layer--exiting">
          {state.exiting.node}
        </div>
      )}
      <div key={state.current.key} className="crossfade__layer crossfade__layer--current">
        {state.current.node}
      </div>
    </div>
  );
}
