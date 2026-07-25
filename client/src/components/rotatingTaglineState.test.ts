import { describe, expect, it } from "vitest";
import { setHovered, tick, type RotationState } from "./rotatingTaglineState";

describe("tick", () => {
  it("advances the index when not hovered", () => {
    const state: RotationState = { index: 0, hovered: false };
    expect(tick(state, 5)).toEqual({ index: 1, hovered: false });
  });

  it("wraps the index around the language count", () => {
    const state: RotationState = { index: 4, hovered: false };
    expect(tick(state, 5)).toEqual({ index: 0, hovered: false });
  });

  it("freezes the index while hovered", () => {
    const state: RotationState = { index: 2, hovered: true };
    expect(tick(state, 5)).toEqual({ index: 2, hovered: true });
  });
});

describe("setHovered", () => {
  it("sets hovered to true without touching the index", () => {
    const state: RotationState = { index: 3, hovered: false };
    expect(setHovered(state, true)).toEqual({ index: 3, hovered: true });
  });

  it("sets hovered to false without touching the index", () => {
    const state: RotationState = { index: 3, hovered: true };
    expect(setHovered(state, false)).toEqual({ index: 3, hovered: false });
  });
});
