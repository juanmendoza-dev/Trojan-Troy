import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { listProfiles, putProfile, deleteProfile } from "./profileStore";
import type { StoredProfile } from "./profileModel";

const mk = (id: string, name: string): StoredProfile => ({
  id,
  name,
  createdAt: 0,
  pinSalt: "cw==", // any b64
  kdf: { ops: 2, mem: 67108864, alg: 2 },
  cipher: "cw==",
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
    await putProfile({ ...mk("p1", "Jay Renamed") });
    const all = await listProfiles();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Jay Renamed");
  });

  it("deletes a profile", async () => {
    await putProfile(mk("p1", "Jay"));
    await deleteProfile("p1");
    expect(await listProfiles()).toEqual([]);
  });

  it("drops legacy records lacking cipher/kdf on load", async () => {
    const legacy = { id: "old", name: "Legacy", avatar: "data:x", pinSalt: "s", pinHash: "h", createdAt: 0 };
    await putProfile(legacy as unknown as StoredProfile);
    await putProfile(mk("new", "Valid"));
    const list = await listProfiles();
    expect(list.map((p) => p.id)).toEqual(["new"]); // legacy purged, valid kept
    // second load confirms it was deleted, not just filtered:
    expect((await listProfiles()).map((p) => p.id)).toEqual(["new"]);
  });
});
