import { describe, expect, it } from "vitest";
import { withActiveKey, settled, type CrossfadeState } from "./crossfadeState";

describe("withActiveKey", () => {
  it("moves the previous current layer to exiting when the key changes", () => {
    const state: CrossfadeState = { current: { key: "a", node: "A" }, exiting: null };
    const next = withActiveKey(state, "b", "B");
    expect(next.current).toEqual({ key: "b", node: "B" });
    expect(next.exiting).toEqual({ key: "a", node: "A" });
  });

  it("updates the current node in place without touching exiting when the key is unchanged", () => {
    const state: CrossfadeState = {
      current: { key: "a", node: "A" },
      exiting: { key: "z", node: "Z" },
    };
    const next = withActiveKey(state, "a", "A2");
    expect(next.current).toEqual({ key: "a", node: "A2" });
    expect(next.exiting).toEqual({ key: "z", node: "Z" });
  });
});

describe("settled", () => {
  it("clears an exiting layer", () => {
    const state: CrossfadeState = {
      current: { key: "a", node: "A" },
      exiting: { key: "z", node: "Z" },
    };
    expect(settled(state)).toEqual({ current: { key: "a", node: "A" }, exiting: null });
  });

  it("is a no-op when there's nothing exiting", () => {
    const state: CrossfadeState = { current: { key: "a", node: "A" }, exiting: null };
    expect(settled(state)).toEqual(state);
  });
});
