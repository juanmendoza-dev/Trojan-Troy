import { nextTaglineIndex, TAGLINE_LANGS } from "./taglineLangs";

export interface RotationState {
  index: number;
  hovered: boolean;
}

export function tick(state: RotationState, length: number = TAGLINE_LANGS.length): RotationState {
  if (state.hovered) return state;
  return { ...state, index: nextTaglineIndex(state.index, length) };
}

export function setHovered(state: RotationState, hovered: boolean): RotationState {
  return { ...state, hovered };
}
