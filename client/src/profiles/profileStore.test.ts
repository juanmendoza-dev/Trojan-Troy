import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listProfiles, putProfile, deleteProfile } from "./profileStore";
import type { Profile } from "./profileModel";

const mk = (id: string, name: string): Profile => ({
  id,
  name,
  avatar: null,
  pinSalt: "s",
  pinHash: "h",
  createdAt: 0,
});

describe("profileStore", () => {
  beforeEach(async () => {
    for (const p of await listProfiles()) await deleteProfile(p.id);
  });

  it("puts and lists profiles", async () => {
    await putProfile(mk("p1", "Jay"));
    await putProfile(mk("p2", "Work"));
    const names = (await listProfiles()).map((p) => p.name).sort();
    expect(names).toEqual(["Jay", "Work"]);
  });

  it("overwrites a profile with the same id", async () => {
    await putProfile(mk("p1", "Jay"));
    await putProfile({ ...mk("p1", "Jay Renamed"), avatar: "data:image/jpeg;base64,zzz" });
    const all = await listProfiles();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Jay Renamed");
  });

  it("deletes a profile", async () => {
    await putProfile(mk("p1", "Jay"));
    await deleteProfile("p1");
    expect(await listProfiles()).toEqual([]);
  });
});
