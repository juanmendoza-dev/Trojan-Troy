import type { ReactNode } from "react";

export interface CrossfadeLayer {
  key: string;
  node: ReactNode;
}

export interface CrossfadeState {
  current: CrossfadeLayer;
  exiting: CrossfadeLayer | null;
}

export function withActiveKey(state: CrossfadeState, key: string, node: ReactNode): CrossfadeState {
  if (state.current.key === key) {
    return { current: { key, node }, exiting: state.exiting };
  }
  return { current: { key, node }, exiting: state.current };
}

export function settled(state: CrossfadeState): CrossfadeState {
  if (state.exiting === null) return state;
  return { current: state.current, exiting: null };
}
