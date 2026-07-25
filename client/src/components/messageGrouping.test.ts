import { describe, expect, it } from "vitest";
import { endsGroup, type GroupItem } from "./messageGrouping";

const text = (from: "me" | "peer"): GroupItem => ({ from, kind: "text" });
const err = (): GroupItem => ({ kind: "decryption-error" });

describe("endsGroup", () => {
  it("is true for the final message", () => {
    expect(endsGroup([text("me")], 0)).toBe(true);
    expect(endsGroup([text("peer"), text("peer")], 1)).toBe(true);
  });

  it("is true when the next message is a different sender", () => {
    expect(endsGroup([text("me"), text("peer")], 0)).toBe(true);
  });

  it("is false mid-run (same sender follows)", () => {
    expect(endsGroup([text("peer"), text("peer"), text("me")], 0)).toBe(false);
  });

  it("treats a decryption-error as its own group boundary", () => {
    expect(endsGroup([text("peer"), err()], 0)).toBe(true);
    expect(endsGroup([err(), text("peer")], 0)).toBe(true);
  });
});
