import { test, expect, type Page } from "@playwright/test";

// WP-D: the chat shell on a phone — drawer, composer, voice preview, auto-scroll.
//
// These assert *element geometry*, deliberately, because the obvious check does
// not work here. `document.documentElement.scrollWidth <= window.innerWidth`
// passed on the pre-WP-D chat screen at every size: the roots are
// `position: fixed`, so flexbox squeezed the message column down to 134px of a
// 390px viewport and pushed the composer's buttons 130px off the right edge
// without ever growing the document's scroll width. A green overflow assertion
// meant nothing. So the checks below are about where things actually are — the
// drawer is off-canvas, main really is full width, a bubble is wider than one
// character — and the overflow check rides along as a supplement, never alone.

const MOBILE_PROJECTS = ["iphone-safari", "android-chrome"];

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  const value = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  }, selector);
  expect(value, `${selector} should be in the DOM`).not.toBeNull();
  return value as Box;
}

async function expectTapTarget(page: Page, selector: string): Promise<Box> {
  const b = await box(page, selector);
  expect(Math.round(b.width), `${selector} tap width`).toBeGreaterThanOrEqual(44);
  expect(Math.round(b.height), `${selector} tap height`).toBeGreaterThanOrEqual(44);
  return b;
}

async function noHorizontalOverflow(page: Page): Promise<number> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow, "horizontal overflow (supplementary check)").toBeLessThanOrEqual(0);
  return overflow;
}

/** Wait out the 260ms drawer slide by polling the live rect instead of sleeping. */
async function settledRect(page: Page, selector: string, key: keyof Box, matcher: (v: number) => boolean) {
  await expect
    .poll(async () => matcher((await box(page, selector))[key]), { timeout: 3000 })
    .toBe(true);
  return box(page, selector);
}

// A 4-byte blob through the real component path: VoiceRecorder still calls
// startRecording(), still awaits the MediaRecorder's stop, still renders the real
// <audio> and the real buttons. Only the two platform APIs Playwright can't give
// us (a microphone, a working encoder) are stood in for.
async function stubMicrophone(page: Page) {
  await page.addInitScript(() => {
    class StubRecorder {
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      mimeType: string;
      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }
      static isTypeSupported() {
        return true;
      }
      start() {
        this.state = "recording";
      }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3, 4])], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: StubRecorder });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
  });
}

test.describe("chat screen on a phone", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(!MOBILE_PROJECTS.includes(testInfo.project.name), "mobile projects only");
  });

  test("is a single full-width column with the sidebar off-canvas", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    await page.waitForSelector(".chat-screen");

    const width = page.viewportSize()!.width;
    const sidebar = await box(page, ".sidebar");
    const main = await box(page, ".chat-screen__main");
    const bubble = await box(page, ".message-bubble");

    // Drawer parked: its right edge is at or left of the viewport's left edge.
    expect(sidebar.right, "parked drawer right edge").toBeLessThanOrEqual(0.5);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".chat-screen__scrim")).toHaveCount(0);

    // The chat gets the whole width — this is what the old overflow check missed.
    expect(main.width, "main column width").toBeGreaterThan(width - 4);
    expect(main.left, "main column left edge").toBeLessThanOrEqual(0.5);

    // The direct regression test for the one-character-per-line break: this
    // bubble measured 34px wide × 528px tall before WP-D.
    expect(bubble.width, "message bubble width").toBeGreaterThan(100);
    expect(bubble.height, "message bubble height").toBeLessThan(120);

    const overflow = await noHorizontalOverflow(page);

    console.log(
      `[${testInfo.project.name}] layout ` +
        JSON.stringify({ innerWidth: width, sidebar, main, bubble, overflow })
    );
    await testInfo.attach(`chat-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

  test("the hamburger opens the drawer and the scrim closes it", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    await page.waitForSelector(".chat-screen");

    const menu = page.locator(".title-bar__menu");
    await expect(menu).toBeVisible();
    const menuBox = await expectTapTarget(page, ".title-bar__menu");
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    await menu.click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const scrim = page.locator(".chat-screen__scrim");
    await expect(scrim).toBeVisible();
    const openSidebar = await settledRect(page, ".sidebar", "left", (v) => v >= -0.5);
    expect(openSidebar.left, "open drawer left edge").toBeGreaterThanOrEqual(-0.5);
    expect(openSidebar.width, "open drawer width").toBeGreaterThan(200);
    expect(openSidebar.width, "open drawer leaves the chat visible").toBeLessThan(
      page.viewportSize()!.width
    );

    await testInfo.attach(`chat-drawer-open-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    // Tap the scrim clear of the drawer that sits on top of it.
    const scrimBox = await box(page, ".chat-screen__scrim");
    await scrim.click({ position: { x: scrimBox.width - 20, y: 120 } });
    const closedSidebar = await settledRect(page, ".sidebar", "right", (v) => v <= 0.5);
    expect(closedSidebar.right, "re-parked drawer right edge").toBeLessThanOrEqual(0.5);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(scrim).toHaveCount(0);

    // …and the hamburger still works after a scrim close.
    await menu.click();
    await settledRect(page, ".sidebar", "left", (v) => v >= -0.5);
    await expect(page.locator(".sidebar")).toBeVisible();

    console.log(
      `[${testInfo.project.name}] drawer ` +
        JSON.stringify({ menuBox, openSidebar, closedSidebar })
    );
  });

  test("pauses the sidebar visualizers while the drawer is parked", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    // Attached, not visible — the parked drawer is `visibility: hidden` by design.
    await page.waitForSelector(".viz-packet__p", { state: "attached" });

    const playState = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector(".viz-packet__p")!).animationPlayState
      );

    const parked = await playState();
    expect(parked, "packet animation while the drawer is parked").toBe("paused");

    await page.locator(".title-bar__menu").click();
    await expect(page.locator(".sidebar")).toBeVisible();
    const opened = await playState();
    expect(opened, "packet animation while the drawer is open").toBe("running");

    console.log(`[${testInfo.project.name}] viz ` + JSON.stringify({ parked, opened }));
  });

  test("composer is reachable, 16px, and thumb-sized", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    await page.waitForSelector(".composer");

    const width = page.viewportSize()!.width;
    const fontSize = await page.evaluate(
      () => getComputedStyle(document.querySelector(".composer__input")!).fontSize
    );
    // Exactly 16px: anything smaller and iOS Safari zooms the page in on focus.
    expect(fontSize, "composer input font-size").toBe("16px");

    const mic = await expectTapTarget(page, ".composer__mic");
    const send = await expectTapTarget(page, ".composer__send-button");
    const composer = await box(page, ".composer");

    // Both controls are on screen — before WP-D the mic sat at x=521 on a 390px
    // viewport, and the overflow assertion still passed.
    for (const [name, b] of [["mic", mic], ["send", send]] as const) {
      expect(b.right, `${name} right edge on screen`).toBeLessThanOrEqual(width + 0.5);
      expect(b.left, `${name} left edge on screen`).toBeGreaterThanOrEqual(0);
    }
    // The composer is the flex:none bottom child of the --app-height column, which
    // is what makes it ride above the soft keyboard. Both halves of that are
    // checkable here; the keyboard itself needs a real device (see the report).
    //
    // Measured *relatively*, because the screen's 350ms crossfadeIn entrance is a
    // translateY(8px) — absolute rects drift by a few px while it plays, and
    // useAppHeight rounds the variable, so comparing the two directly is flaky.
    const chatScreen = await box(page, ".chat-screen");
    const appHeight = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--app-height"))
    );
    expect(
      Math.abs(composer.bottom - chatScreen.bottom),
      "composer sits flush on the bottom of the app column"
    ).toBeLessThan(1);
    expect(
      Math.abs(chatScreen.height - appHeight),
      "app column is the measured visual-viewport height"
    ).toBeLessThanOrEqual(1);

    console.log(
      `[${testInfo.project.name}] composer ` +
        JSON.stringify({ fontSize, mic, send, composer, chatScreen, appHeight })
    );
  });

  test("voice record → preview fits on screen with tappable controls", async ({ page }, testInfo) => {
    await stubMicrophone(page);
    await page.goto("/?screen=chat");
    await page.waitForSelector(".composer__mic");

    const width = page.viewportSize()!.width;

    await page.locator(".composer__mic").click();
    await expect(page.locator(".composer__recording")).toBeVisible();
    const stop = await expectTapTarget(page, ".composer__stop");
    const recordingRow = await box(page, ".composer__recording");
    expect(recordingRow.right, "recording row right edge").toBeLessThanOrEqual(width + 0.5);
    // The row is handed over — the text input isn't competing for the width.
    await expect(page.locator(".composer__input-wrap")).toBeHidden();

    await page.locator(".composer__stop").click();
    await expect(page.locator(".composer__preview")).toBeVisible();

    const preview = await box(page, ".composer__preview");
    const audio = await box(page, ".composer__preview audio");
    const sendClip = await expectTapTarget(page, ".composer__send");
    const discard = await expectTapTarget(page, ".composer__discard");

    expect(preview.left, "preview left edge").toBeGreaterThanOrEqual(0);
    expect(preview.right, "preview right edge").toBeLessThanOrEqual(width + 0.5);
    expect(audio.width, "audio element fits its block").toBeLessThanOrEqual(preview.width);
    expect(audio.right, "audio right edge").toBeLessThanOrEqual(width + 0.5);
    for (const [name, b] of [["send", sendClip], ["discard", discard]] as const) {
      expect(b.right, `${name} right edge on screen`).toBeLessThanOrEqual(width + 0.5);
      expect(b.left, `${name} left edge on screen`).toBeGreaterThanOrEqual(0);
    }
    // Stacked, not squeezed into the row beside the clip.
    expect(sendClip.top, "actions sit below the clip").toBeGreaterThan(audio.bottom - 1);

    const overflow = await noHorizontalOverflow(page);

    console.log(
      `[${testInfo.project.name}] voice ` +
        JSON.stringify({ stop, recordingRow, preview, audio, send: sendClip, discard, overflow })
    );
    await testInfo.attach(`chat-voice-preview-${testInfo.project.name}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await page.locator(".composer__discard").click();
    await expect(page.locator(".composer__input-wrap")).toBeVisible();
  });

  // WP-F owns the popover, but WP-D puts `overflow: hidden` on the chat body to
  // stop the parked drawer being scrollable to — so guard that it didn't start
  // clipping the one thing rendered outside that box.
  test("the avatar popover still opens and stays on screen", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    await page.waitForSelector(".message-avatar");

    const width = page.viewportSize()!.width;
    await page.locator(".message-avatar").first().click();
    await expect(page.locator(".profile-card")).toBeVisible();

    const card = await box(page, ".profile-card");
    expect(card.left, "popover left edge").toBeGreaterThanOrEqual(0);
    expect(card.right, "popover right edge").toBeLessThanOrEqual(width + 0.5);
    expect(card.top, "popover top edge").toBeGreaterThanOrEqual(0);

    console.log(`[${testInfo.project.name}] popover ` + JSON.stringify(card));
  });

  test("keeps the newest message in view when the viewport shrinks", async ({ page }, testInfo) => {
    await page.goto("/?screen=chat");
    await page.waitForSelector(".chat-screen__messages");

    // A short viewport is the closest Playwright gets to the soft keyboard: the
    // measured column shrinks, the message list starts overflowing, and the
    // newest message has to stay pinned.
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 320 });

    const readScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector(".chat-screen__messages")!;
        return {
          scrollTop: Math.round(el.scrollTop),
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 2,
        };
      });

    await expect.poll(async () => (await readScroll()).atBottom, { timeout: 3000 }).toBe(true);
    const scroll = await readScroll();

    // Prove the assertion above wasn't trivially true on a list that fits.
    expect(scroll.scrollHeight, "message list genuinely overflows").toBeGreaterThan(
      scroll.clientHeight
    );
    expect(scroll.scrollTop, "scrolled down to the newest message").toBeGreaterThan(0);

    console.log(`[${testInfo.project.name}] autoscroll ` + JSON.stringify(scroll));
  });
});

// The narrowest size in the spec's definition of done. Neither device project is
// 360px wide (iPhone 13 is 390, Pixel 7 is 412), so drive it explicitly.
test("chat holds together at 360px", async ({ page }, testInfo) => {
  test.skip(!MOBILE_PROJECTS.includes(testInfo.project.name), "mobile projects only");

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?screen=chat");
  await page.waitForSelector(".chat-screen");

  const sidebar = await box(page, ".sidebar");
  const main = await box(page, ".chat-screen__main");
  const bubble = await box(page, ".message-bubble");
  expect(sidebar.right, "parked drawer right edge at 360px").toBeLessThanOrEqual(0.5);
  expect(main.width, "main column width at 360px").toBeGreaterThan(356);
  expect(bubble.width, "bubble width at 360px").toBeGreaterThan(100);
  await expectTapTarget(page, ".composer__mic");
  await expectTapTarget(page, ".composer__send-button");
  const overflow = await noHorizontalOverflow(page);

  await page.locator(".title-bar__menu").click();
  const openSidebar = await settledRect(page, ".sidebar", "left", (v) => v >= -0.5);
  expect(openSidebar.width, "drawer clamps to 84vw at 360px").toBeLessThanOrEqual(360);

  console.log(
    `[${testInfo.project.name}] 360px ` + JSON.stringify({ sidebar, main, bubble, openSidebar, overflow })
  );
  await testInfo.attach(`chat-360-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

// The other half of the contract: none of the above may reach desktop.
test("desktop chat layout is unchanged", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chrome", "desktop project only");

  await page.goto("/?screen=chat");
  await page.waitForSelector(".chat-screen");

  const sidebar = await box(page, ".sidebar");
  expect(sidebar.width, "desktop sidebar width").toBe(256);
  expect(sidebar.left, "desktop sidebar is in flow, not off-canvas").toBe(0);
  await expect(page.locator(".sidebar")).toBeVisible();

  await expect(page.locator(".title-bar__menu")).toBeHidden();
  await expect(page.locator(".chat-screen__scrim")).toHaveCount(0);
  await expect(page.locator(".title-bar__room")).toBeVisible();
  await expect(page.locator(".title-bar__verified")).toBeVisible();
  await expect(page.locator(".title-bar__peer")).toBeVisible();

  const main = await box(page, ".chat-screen__main");
  expect(main.left, "desktop main starts after the sidebar").toBe(256);

  const fontSize = await page.evaluate(
    () => getComputedStyle(document.querySelector(".composer__input")!).fontSize
  );
  expect(fontSize, "desktop composer font-size").toBe("15px");
  const mic = await box(page, ".composer__mic");
  expect(mic.width, "desktop mic size").toBe(42);
  expect(mic.height, "desktop mic size").toBe(42);
  const titleBar = await box(page, ".title-bar");
  expect(titleBar.height, "desktop title bar height").toBe(46);

  // Nothing is paused when there's no drawer to close.
  const playState = await page.evaluate(
    () => getComputedStyle(document.querySelector(".viz-packet__p")!).animationPlayState
  );
  expect(playState, "desktop packet animation").toBe("running");

  console.log(
    `[${testInfo.project.name}] desktop ` +
      JSON.stringify({ sidebar, main, mic, titleBar, fontSize, playState })
  );
  await testInfo.attach(`chat-desktop-${testInfo.project.name}`, {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
