import { describe, expect, it } from "vitest";
import { resolveActiveProfile, ANONYMOUS_ID, type Profile } from "./profileModel";

const jay: Profile = {
  id: "p1",
  name: "Jay",
  avatar: null,
  pinSalt: "s",
  pinHash: "h",
  createdAt: 0,
};

describe("resolveActiveProfile", () => {
  it("returns anonymous for null or the anonymous id", () => {
    expect(resolveActiveProfile([jay], null).kind).toBe("anonymous");
    expect(resolveActiveProfile([jay], ANONYMOUS_ID).kind).toBe("anonymous");
  });

  it("returns the named profile when the id matches", () => {
    expect(resolveActiveProfile([jay], "p1")).toEqual({ kind: "named", profile: jay });
  });

  it("falls back to anonymous when the id is unknown (e.g. deleted)", () => {
    expect(resolveActiveProfile([jay], "gone").kind).toBe("anonymous");
  });
});
