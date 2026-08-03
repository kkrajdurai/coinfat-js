/**
 * The guarantees jsdom cannot judge, having no CSS, no layout and no focus model: style
 * isolation both ways across the shadow boundary, the modal's Tab focus trap, the
 * attribution badge never painting over the card (it is `pointer-events-none`, so an
 * overlap silently swallows clicks on whatever it covers), and the deposit address
 * wrapping inside its field rather than overflowing it.
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

// The address is the longest unbroken string on the panel and the one a payer checks
// character by character. It is no longer shortened — an ellipsis through the middle
// cost three rounds of engine-specific defects to hide characters somebody might want —
// so what has to hold is that it WRAPS: every character painted, at every width, without
// pushing the card wider than its container.
test.describe("the deposit address", () => {
  for (const [name, address] of [
    ["hex", "0x000000000000000000000000000000000000dEaD"],
    ["bech32", "tb1q7q8ru09f7awg7v2mgmhw6zvnhtnsqpm28wks48r9cmmrn6ax6trstl6hw"]
  ]) {
    test(`wraps rather than overflowing (${name})`, async ({page}) => {
      const invoice = JSON.parse(JSON.stringify(fixtures.invoice)) as {
        active_payment: {address: string};
      };
      invoice.active_payment.address = address;
      // Every route that returns an invoice, not just `show`: the rate lock elapses
      // mid-sweep and requotes, and the shared stub would answer that with the
      // FIXTURE's address, quietly swapping the string under test.
      for (const path of [
        `**/checkout/${ULID}`,
        `**/checkout/${ULID}/select`,
        `**/checkout/${ULID}/requote`
      ]) {
        await page.route(path, (route) =>
          route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(invoice)
          })
        );
      }
      await page.reload();
      await page.waitForFunction(() => "Coinfat" in window);

      await page.evaluate(
        ({api, ulid}) =>
          window
            .Coinfat({apiBase: api})
            .checkout({invoice: ulid, display: "inline", mount: "#btn-mount"}),
        {api: API, ulid: ULID}
      );

      const host = page.locator("#btn-mount [data-coinfat]");
      await expect
        .poll(() =>
          host.evaluate(
            (el) =>
              !!(
                el as HTMLElement & {shadowRoot: ShadowRoot}
              ).shadowRoot.querySelector("span.font-mono")
          )
        )
        .toBe(true);

      const offences: string[] = [];
      const widths = new Set<number>();

      for (let width = 180; width <= 1000; width += 4) {
        const probe = await host.evaluate((el, w) => {
          document.getElementById("btn-mount")!.style.width = `${w}px`;
          const root = (el as HTMLElement & {shadowRoot: ShadowRoot})
            .shadowRoot;
          const field = root.querySelector("span.font-mono") as HTMLElement;
          // `.cf-app`, not `firstElementChild` — that is the injected <style>, whose
          // clientWidth is 0 at every width, which passed as a swept sample.
          const card = root.querySelector(".cf-app") as HTMLElement;
          const spill = (node: HTMLElement) =>
            Math.round(node.scrollWidth - node.clientWidth);

          return {
            // Proof the resize landed, so a stuck layout cannot pass as 400 clean
            // samples — an earlier version of this sweep did exactly that.
            width: card.clientWidth,
            text: field.textContent,
            // The whole point: it breaks mid-string instead of running past its box.
            fieldSpill: spill(field),
            // And nothing it sits inside is pushed wide either — a `break-all` that
            // does not apply shows up here first, as a card wider than its slot.
            cardSpill: spill(card),
            lines: Math.round(
              field.getBoundingClientRect().height /
                parseFloat(getComputedStyle(field).lineHeight)
            ),
            // Characters the field has room for on one line, and how many lines that
            // many would take. Both measured from the font rather than assumed, so
            // they hold at any size or face.
            ...(() => {
              const ruler = document.createElement("span");
              ruler.style.cssText =
                "position:absolute;visibility:hidden;white-space:pre";
              field.appendChild(ruler);
              ruler.textContent = "0".repeat(10);
              const advance = ruler.getBoundingClientRect().width / 10;
              ruler.remove();
              const perLine = Math.max(
                1,
                Math.floor(field.clientWidth / advance)
              );
              return {
                perLine,
                packed: Math.ceil((field.textContent ?? "").length / perLine)
              };
            })()
          };
        }, width);

        widths.add(probe.width);

        if (probe.text !== address) {
          offences.push(`${width}px: rendered ${probe.text}`);
        }
        // A pixel of rounding is not a spill; a character is.
        if (probe.fieldSpill > 1) {
          offences.push(
            `${width}px: address overflows by ${probe.fieldSpill}px`
          );
        }
        if (probe.cardSpill > 1) {
          offences.push(`${width}px: card overflows by ${probe.cardSpill}px`);
        }
        // Wrapping is the trade being made; an address trickling down the card a
        // character or two per line is not. Two checks, because neither sees the
        // other's failure.
        //
        // First, the field stays wide enough to be worth reading. The floor sits below
        // the narrowest real measurement — 11 characters, WebKit at 180px, whose
        // advance runs wider than the other two — and well above a squeezed column.
        if (probe.perLine < 8) {
          offences.push(
            `${width}px: only ${probe.perLine} characters per line`
          );
        }
        // Second, the lines are actually filled. Compared against a full pack of the
        // width available rather than a fixed line count: a constant would have to sit
        // at the observed maximum (6, for bech32 at the narrowest width swept), where
        // it could only ever fire on font drift, never on the defect it names.
        if (probe.lines > probe.packed + 1) {
          offences.push(
            `${width}px: ${probe.lines} lines where ${probe.packed} would hold it`
          );
        }
      }

      expect(offences.slice(0, 5)).toEqual([]);
      expect(widths.size).toBeGreaterThan(50);
    });
  }
});

// The FAQ swaps itself into the same card, so it inherits the card's two layout
// obligations — stay inside the container, stay clear of the badge — under content the
// pay panel never produces: eight stacked rows and a paragraph that reflows with width.
test.describe("the FAQ", () => {
  const openFaq = async (page: Page, host: string) => {
    const shadow = page.locator(host);
    await shadow.locator('[aria-label="Common questions"]').click();
    await shadow.locator("h3 button").first().waitFor();
    return shadow;
  };

  test.describe("in a narrow inline slot", () => {
    test("fits without a scrollbar and without widening the slot", async ({
      page
    }) => {
      // 300px: narrower than any real column, and the width the 34rem cap was
      // measured against.
      await page.evaluate(
        ({api, ulid}) => {
          const slot = document.querySelector<HTMLElement>("#btn-mount")!;
          slot.style.width = "300px";
          window.Coinfat({apiBase: api}).checkout({
            invoice: ulid,
            display: "inline",
            mount: "#btn-mount",
            layout: "narrow"
          });
        },
        {api: API, ulid: ULID}
      );

      const shadow = await openFaq(page, "#btn-mount [data-coinfat]");
      // Every question the fixture offers, not a hardcoded eight: a count that drifts
      // from the table silently stops sweeping whatever was added.
      const count = await shadow.locator("h3 button").count();
      expect(count).toBeGreaterThan(4);

      for (let index = 0; index < count; index++) {
        // One answer at a time is the design, so each is measured on its own.
        const question = shadow.locator("h3 button").nth(index);
        await question.click();

        const probe = await page.evaluate(() => {
          const sr = document.querySelector("[data-coinfat]")!.shadowRoot!;
          const list = sr.querySelector<HTMLElement>(".overscroll-contain")!;
          // Scoped to the questions: the header trigger carries `aria-expanded` too,
          // and it is the one that is true whenever the FAQ is showing at all.
          const open = sr.querySelector<HTMLElement>(
            'h3 button[aria-expanded="true"]'
          )!;
          const answer = sr.querySelector<HTMLElement>(
            `#${open.getAttribute("aria-controls")}`
          )!;
          const bounds = list.getBoundingClientRect();

          // Measured against the LIST, not the card: the card is a plain block, so its
          // width tracks the slot's whatever it holds — an overflow check on it reads
          // 0 through content that spills a mile, and can never fail.
          const past = (element: HTMLElement) =>
            Math.round(element.getBoundingClientRect().right - bounds.right);

          return {
            // The stock table must never engage its own scroller: a clipped question
            // is sliced through its letterforms, which reads as broken, not as "more".
            clipped: list.scrollHeight > list.clientHeight + 1,
            spill: Math.max(
              list.scrollWidth - list.clientWidth,
              past(open),
              past(answer)
            ),
            // The answer is below its question, not beside it.
            answerWraps:
              open.getBoundingClientRect().bottom <=
              answer.getBoundingClientRect().top
          };
        });

        expect(probe, `answer ${index}`).toMatchObject({
          clipped: false,
          answerWraps: true
        });
        expect(probe.spill, `answer ${index}`).toBeLessThanOrEqual(0);

        await question.click();
      }
    });
  });

  test.describe("in a modal on a short viewport", () => {
    test.use({viewport: {width: 390, height: 420}});

    test("never lets the badge paint over the questions", async ({page}) => {
      await page.evaluate(
        ({api, ulid}) =>
          window
            .Coinfat({apiBase: api})
            .checkout({invoice: ulid, display: "modal", layout: "narrow"})
            .open(),
        {api: API, ulid: ULID}
      );

      await page.getByRole("dialog").waitFor();
      const shadow = await openFaq(page, "[data-coinfat]");
      // The tallest answer, so the card is at its worst against a 420px viewport.
      await shadow.locator("h3 button").nth(1).click();

      const reached: number[] = [];

      for (const scrollTop of [0, 9999]) {
        const probe = await page.evaluate((top) => {
          const sr = document.querySelector("[data-coinfat]")!.shadowRoot!;
          // The modal's own scroll viewport: first in document order, since the FAQ
          // list — also `overflow-y-auto` — is nested inside the card within it.
          const scroller = sr.querySelector(".overflow-y-auto")!;
          scroller.scrollTop = top;

          const badge = sr.querySelector<HTMLElement>(
            'div[aria-hidden="true"]'
          )!;
          const b = badge.getBoundingClientRect();

          return {
            // Whatever sits under the badge's middle: the mask, never a question.
            hit: sr.elementFromPoint(
              (b.left + b.right) / 2,
              (b.top + b.bottom) / 2
            )?.className,
            scrolled: scroller.scrollTop
          };
        }, scrollTop);

        reached.push(probe.scrolled);
        expect(probe.hit).toContain("fixed inset-0");
      }

      // The two probes have to be two different situations. A card that fits the
      // viewport cannot scroll, and the loop would then assert the same frame twice —
      // passing without ever putting the card's bottom edge next to the badge.
      expect(reached[0]).toBe(0);
      expect(reached[1]).toBeGreaterThan(0);
    });
  });
});
