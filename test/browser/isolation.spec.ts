/**
 * The three guarantees jsdom cannot judge, having no CSS, no layout and no focus model:
 * style isolation both ways across the shadow boundary, the modal's Tab focus trap, and
 * the attribution badge never painting over the card (it is `pointer-events-none`, so
 * an overlap silently swallows clicks on whatever it covers).
 *
 * Hermetic: the built IIFE bundle is served and every API call is fulfilled from a
 * fixture. Build first — the spec loads `dist/coinfat.iife.js`.
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
// A fabricated origin: the page, the bundle and the API all route to it, so every
// request is same-origin and no CORS handshake is needed.
const ORIGIN = "http://coinfat.test";
const API = `${ORIGIN}/api/v1`;

// Deliberately hostile host CSS: the red text, Comic Sans and lime button must not
// show up inside the widget. The <h1> is the leak-out probe — its default margin must
// survive, i.e. the widget's preflight (which zeroes h1 margins) stayed in the shadow.
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
  // The drop-in button is the most deterministic subject: one `bg-primary` button with
  // `text-primary-foreground`.
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

  // Inbound: the host's styles stopped at the boundary.
  expect(style.color).not.toBe("rgb(255, 0, 0)");
  expect(style.background).not.toBe("rgb(0, 255, 0)");
  expect(style.font.toLowerCase()).not.toContain("comic sans");
  // And the widget painted an opaque fill of its own. Not pinned to an rgb triple: the
  // brand value is colour-managed and applied async, so the jsdom accent tests own it.
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.background).not.toBe("transparent");

  // Outbound: Tailwind's preflight would have zeroed the light-DOM <h1>'s margin.
  const h1MarginTop = await page
    .locator("#probe-h1")
    .evaluate((el) => getComputedStyle(el).marginTop);
  expect(parseFloat(h1MarginTop)).toBeGreaterThan(0);
});

test("the modal traps Tab focus and restores it to the opener on Escape", async ({
  page,
  browserName
}) => {
  // WebKit under automation does not Tab-focus non-input controls (Safari's "Full
  // Keyboard Access" default, untoggleable headlessly). Chromium + Firefox cover it.
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

  // Wait for the pay panel's real focusables, not the skeleton — the trap is only
  // meaningful once there is more than one.
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

  // Tab well past the number of focusables, then back through the wrap point.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await deepActiveEscaped()).toBe(false);
  }
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await deepActiveEscaped()).toBe(false);
  }

  // The fixture has a live payment, so Escape raises the close warning rather than
  // closing. Confirming through it is the only way out — which is the point of the
  // guard, and makes this the end-to-end check that focus still comes home afterwards.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(1);
  await page.getByRole("button", {name: "Close anyway"}).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#background-btn")).toBeFocused();
});

// A landscape phone: short enough that the pay panel overflows the viewport, which is
// the only condition under which the badge and the card can meet. A content-anchored
// gutter (bottom padding on the scrolling wrapper) passed at every taller size and
// failed here, with the badge landing on the "Open in wallet" link.
test.describe("the attribution badge", () => {
  test.use({viewport: {width: 390, height: 420}});

  test("never paints over the card, however the overlay is scrolled", async ({
    page
  }) => {
    await page.evaluate(
      ({api, ulid}) =>
        window
          .Coinfat({apiBase: api})
          .checkout({invoice: ulid, display: "modal", layout: "narrow"})
          .open(),
      {api: API, ulid: ULID}
    );

    await page.getByRole("dialog").waitFor();
    // Wait for the pay panel, not the skeleton — the skeleton is short enough to fit.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const sr = document.querySelector("[data-coinfat]")!.shadowRoot!;
          return sr.querySelector(".overflow-y-auto")!.scrollHeight;
        })
      )
      .toBeGreaterThan(420);

    for (const scrollTop of [0, 9999]) {
      const probe = await page.evaluate((top) => {
        const sr = document.querySelector("[data-coinfat]")!.shadowRoot!;
        const scroller = sr.querySelector(".overflow-y-auto")!;
        scroller.scrollTop = top;

        const badge = sr.querySelector<HTMLElement>('div[aria-hidden="true"]')!;
        const b = badge.getBoundingClientRect();
        const d = sr
          .querySelector<HTMLElement>('[role="dialog"]')!
          .getBoundingClientRect();
        const s = scroller.getBoundingClientRect();

        // The card's VISIBLE rect: its layout box clipped to the scroll viewport.
        // Its unclipped box extends past the clip and would false-positive here.
        const card = {
          left: Math.max(d.left, s.left),
          right: Math.min(d.right, s.right),
          top: Math.max(d.top, s.top),
          bottom: Math.min(d.bottom, s.bottom)
        };

        return {
          overlaps: !(
            b.right < card.left ||
            b.left > card.right ||
            b.bottom < card.top ||
            b.top > card.bottom
          ),
          // What a click in the middle of the badge actually lands on.
          hit: sr.elementFromPoint(
            (b.left + b.right) / 2,
            (b.top + b.bottom) / 2
          )?.className
        };
      }, scrollTop);

      expect(probe.overlaps).toBe(false);
      // The mask, so the click closes the modal like any other part of it.
      expect(probe.hit).toContain("fixed inset-0");
    }
  });
});
