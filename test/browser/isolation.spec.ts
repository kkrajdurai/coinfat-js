/**
 * Real-browser checks for the two guarantees jsdom cannot make good on, because jsdom
 * applies no CSS and has no focus model:
 *
 *   1. Style isolation — the widget renders in a shadow root, so hostile host-page CSS
 *      must not reach in, and the widget's Tailwind reset must not leak out.
 *   2. The modal focus trap — real Tab / Shift+Tab must cycle within the dialog and
 *      never escape to the page, and focus must return to the opener on close.
 *
 * The whole run is hermetic: the built IIFE bundle is served, and every checkout API
 * call is fulfilled from a sanitised fixture, so nothing touches the network. Build
 * first (`npm run build`) — the spec loads `dist/coinfat.iife.js`.
 */

import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {expect, test, type Page, type Route} from "@playwright/test";

const BUNDLE = fileURLToPath(
  new URL("../../dist/coinfat.iife.js", import.meta.url)
);
const fixtures = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures.json", import.meta.url)),
    "utf8"
  )
) as {invoice: unknown; wallets: unknown; ulid: string};

const ULID = fixtures.ulid;
// A fabricated origin: the page, the bundle and the API all resolve to it through
// route(), so every request is same-origin and no CORS handshake is needed.
const ORIGIN = "http://coinfat.test";
const API = `${ORIGIN}/api/v1`;

// Host page with deliberately hostile CSS. `*{color:red !important}` and the lime
// button background are the isolation adversary: neither may show up inside the widget.
// The <h1> is the leak-out probe — its default margin must survive, i.e. the widget's
// preflight (which zeroes h1 margins) must not have escaped the shadow root.
const HOST_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  *, *::before, *::after { color: rgb(255, 0, 0) !important;
                           font-family: "Comic Sans MS", cursive !important; }
  button { background: rgb(0, 255, 0) !important; border: 4px dashed rgb(0,0,255) !important; }
</style></head><body>
  <h1 id="probe-h1">Merchant heading</h1>
  <button id="background-btn">Checkout</button>
  <div id="btn-mount"></div>
  <script src="/coinfat.iife.js"></script>
</body></html>`;

async function stubEnvironment(page: Page): Promise<void> {
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body)
    });

  await page.route(`${ORIGIN}/`, (route) =>
    route.fulfill({contentType: "text/html", body: HOST_HTML})
  );
  await page.route(`${ORIGIN}/coinfat.iife.js`, (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: readFileSync(BUNDLE, "utf8")
    })
  );

  // GET show (also served on each 8s poll), GET wallets, POST select/requote.
  await page.route(`**/checkout/${ULID}/wallets`, (route) =>
    json(route, fixtures.wallets)
  );
  await page.route(`**/checkout/${ULID}/select`, (route) =>
    json(route, fixtures.invoice)
  );
  await page.route(`**/checkout/${ULID}/requote`, (route) =>
    json(route, fixtures.invoice)
  );
  await page.route(`**/checkout/${ULID}`, (route) =>
    json(route, fixtures.invoice)
  );

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => "Coinfat" in window);
}

test.beforeEach(async ({page}) => {
  await stubEnvironment(page);
});

test("host-page CSS cannot pierce the widget, and the widget's reset cannot leak out", async ({
  page
}) => {
  // The drop-in button is the most deterministic isolation subject: one `bg-primary`
  // button (the store's brand blue via brand_color) with `text-primary-foreground`.
  await page.evaluate(
    ({api, ulid}) =>
      window
        .Coinfat({apiBase: api})
        .button({invoice: ulid, mount: "#btn-mount"}),
    {api: API, ulid: ULID}
  );

  const widgetButton = page
    .locator("#btn-mount [data-coinfat]")
    .locator("button");
  await widgetButton.waitFor();

  const style = await widgetButton.evaluate((el) => {
    const s = getComputedStyle(el);
    return {color: s.color, background: s.backgroundColor, font: s.fontFamily};
  });

  // Inbound: the host's red text, lime background and Comic Sans stopped at the boundary.
  expect(style.color).not.toBe("rgb(255, 0, 0)");
  expect(style.background).not.toBe("rgb(0, 255, 0)");
  expect(style.font.toLowerCase()).not.toContain("comic sans");
  // Positive: the widget painted a deliberate, opaque fill of its own — not transparent,
  // so the host page shows through nothing. The exact brand value is browser-colour-
  // managed and applied asynchronously, so it is asserted in the jsdom accent tests, not
  // pinned to an rgb triple here.
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.background).not.toBe("transparent");

  // Outbound: the light-DOM <h1> keeps its default margin. Tailwind's preflight would
  // have zeroed it; a non-zero margin proves the reset stayed inside the shadow root.
  const h1MarginTop = await page
    .locator("#probe-h1")
    .evaluate((el) => getComputedStyle(el).marginTop);
  expect(parseFloat(h1MarginTop)).toBeGreaterThan(0);
});

test("the modal traps Tab focus and restores it to the opener on Escape", async ({
  page,
  browserName
}) => {
  // WebKit under automation does not move Tab focus to buttons/non-input controls
  // (it mirrors Safari's default "Full Keyboard Access" off, which cannot be toggled
  // headlessly), so Tab traversal cannot be exercised there. Chromium + Firefox cover it.
  test.skip(
    browserName === "webkit",
    "WebKit automation does not Tab-focus non-input controls"
  );

  await page.evaluate(
    ({api, ulid}) => {
      const session = window.Coinfat({apiBase: api}).checkout({
        invoice: ulid,
        display: "modal",
        layout: "narrow"
      });
      // Focus the opener first so we can assert focus returns here on close.
      document.getElementById("background-btn")!.focus();
      session.open();
    },
    {api: API, ulid: ULID}
  );

  const dialog = page.getByRole("dialog");
  await dialog.waitFor();

  // Wait for the pay panel to render real focusables (copy fields, change-coin), not
  // just the loading skeleton — the trap is only meaningful once there is more than one.
  await expect
    .poll(() =>
      dialog.evaluate(
        (d) =>
          d.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ).length
      )
    )
    .toBeGreaterThan(1);

  // The active element, descending through shadow roots.
  const deepActiveEscaped = () =>
    page.evaluate(() => {
      let el: Element | null = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      // Escaped iff focus landed back in the light document (e.g. the page button)
      // rather than inside the modal's shadow tree.
      return !el || el.getRootNode() === document;
    });

  // Tab well past the number of focusables: focus must stay inside the dialog the whole
  // way round, never reaching #background-btn or the body.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await deepActiveEscaped()).toBe(false);
  }
  // And backwards, through the wrap point.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await deepActiveEscaped()).toBe(false);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  // Focus handed back to the element that opened the modal.
  await expect(page.locator("#background-btn")).toBeFocused();
});
