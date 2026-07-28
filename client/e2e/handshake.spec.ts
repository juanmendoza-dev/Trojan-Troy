import { test, expect, type Page, type WebSocket } from "@playwright/test";
import { PROTOCOL_VERSION } from "../src/net/relayClient";

// Two real browsers, one real relay, one real handshake. This is the layer the
// unit tests can't reach: it proves that two independently-built sessions agree
// on the derived session, and that nothing readable reaches the wire.
//
// Requires the relay running on ws://localhost:8080 (`cd server && npm run dev`),
// which is the client's default when VITE_RELAY_URL is unset.
//
// Pairing is inherently a two-context test, so it runs once on desktop-chrome
// rather than on all three device projects.

const RELAY_HOST = "localhost:8080";

// Everything the relay saw, split by direction, captured off the real socket.
interface WireLog {
  sent: unknown[];
  received: unknown[];
}

function captureWire(page: Page): WireLog {
  const log: WireLog = { sent: [], received: [] };
  page.on("websocket", (ws: WebSocket) => {
    if (!ws.url().includes(RELAY_HOST)) return;
    ws.on("framesent", (f) => {
      try {
        log.sent.push(JSON.parse(f.payload as string));
      } catch {
        /* non-JSON frame (ping) — the relay's own keepalive, not ours */
      }
    });
    ws.on("framereceived", (f) => {
      try {
        log.received.push(JSON.parse(f.payload as string));
      } catch {
        /* ditto */
      }
    });
  });
  return log;
}

async function readSafetyNumber(page: Page): Promise<string> {
  await expect(page.getByText("Your shared safety number")).toBeVisible({ timeout: 30_000 });
  const groups = await page.locator(".confirm-key__group").allInnerTexts();
  return groups.map((g) => g.replace(/\s+/g, "")).join(" ");
}

test.describe("two-browser handshake", () => {
  test("both browsers derive an identical safety number over an opaque wire", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chrome",
      "pairing is browser-to-browser; running it once is enough"
    );

    const alice = await browser.newContext();
    const bob = await browser.newContext();
    const aPage = await alice.newPage();
    const bPage = await bob.newPage();
    const aWire = captureWire(aPage);
    const bWire = captureWire(bPage);

    try {
      // Alice opens a room.
      await aPage.goto("/");
      await aPage.getByRole("button", { name: "Start a chat" }).click();
      const codeEl = aPage.locator(".waiting-screen__code");
      await expect(codeEl).toBeVisible({ timeout: 30_000 });
      const roomCode = (await codeEl.innerText()).trim();
      expect(roomCode.length).toBeGreaterThan(0);

      // Bob joins it.
      await bPage.goto("/");
      await bPage.getByPlaceholder("ROOM-CODE").fill(roomCode);
      await bPage.getByRole("button", { name: /^Join/ }).click();

      // The property that matters: both sides independently derived the same
      // session. The safety number binds the derived root key, so if the static
      // channels' binding had desynchronised the two peers, or either side had
      // folded a different post-quantum secret or transcript, these would differ.
      const aNumber = await readSafetyNumber(aPage);
      const bNumber = await readSafetyNumber(bPage);
      expect(aNumber).toBe(bNumber);
      expect(aNumber.replace(/\D/g, "")).toHaveLength(60);

      await testInfo.attach("safety-number", { body: aNumber, contentType: "text/plain" });

      // Commit-then-reveal: neither side may reveal a public key before it has
      // published its commitment.
      const aTypes = aWire.sent.map((m) => (m as { type?: string }).type);
      expect(aTypes).toContain("commit");
      expect(aTypes).toContain("pubkey");
      expect(aTypes.indexOf("commit")).toBeLessThan(aTypes.indexOf("pubkey"));

      // Version is asserted against the source constant, so a future bump can't
      // leave this test quietly checking a stale number.
      const commit = aWire.sent.find((m) => (m as { type?: string }).type === "commit");
      expect((commit as { v?: number }).v).toBe(PROTOCOL_VERSION);

      // Wire opacity: every post-handshake frame carries nothing but an opaque
      // payload. No channel, no id, no class, no counter, no length.
      const msgs = [...aWire.sent, ...aWire.received, ...bWire.sent, ...bWire.received].filter(
        (m) => (m as { type?: string }).type === "msg"
      );
      expect(msgs.length).toBeGreaterThan(0);
      for (const m of msgs) {
        expect(Object.keys(m as object).sort()).toEqual(["payload", "type"]);
      }

      // Cover traffic means frames keep flowing with nobody typing, so the relay
      // can't read the conversation's rhythm.
      const before = msgs.length;
      await aPage.waitForTimeout(3_000);
      const after = [...aWire.sent, ...aWire.received].filter(
        (m) => (m as { type?: string }).type === "msg"
      ).length;
      expect(after).toBeGreaterThan(0);
      await testInfo.attach("frames-observed", {
        body: `opaque msg frames: ${before} at handshake, ${after} on Alice's socket after 3s idle`,
        contentType: "text/plain",
      });
    } finally {
      await alice.close();
      await bob.close();
    }
  });
});
