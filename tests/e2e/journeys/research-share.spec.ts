// FR-RESEARCH-004 — share affordance of the public market-research survey. The thank-you page
// (shown after the survey is finished) carries a share button; the shared link must point at the
// public survey and carry the `?src=share-thanks` attribution. The browser share sheet and the
// clipboard are native surfaces Playwright cannot observe, so both are replaced by recorders
// that run before the app boots.
import { test, expect, type Page } from '@playwright/test';
import { expectNoRawI18nKeys, gotoApp } from '../lib/app';

type ShareProbe = { shared: { title?: string; text?: string; url?: string }[]; copied: string[] };

/** Install recorders for `navigator.share` / `navigator.clipboard` before any app script runs. */
async function installShareProbe(page: Page, opts: { withShareSheet: boolean }): Promise<void> {
  await page.addInitScript(({ withShareSheet }) => {
    const probe: ShareProbe = { shared: [], copied: [] };
    (window as unknown as { __shareProbe: ShareProbe }).__shareProbe = probe;
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: withShareSheet
        ? async (data: { title?: string; text?: string; url?: string }) => {
            probe.shared.push(data);
          }
        : undefined,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          probe.copied.push(text);
        },
      },
    });
  }, opts);
}

/** Read what the recorders captured so far. */
function readProbe(page: Page): Promise<ShareProbe> {
  return page.evaluate(() => (window as unknown as { __shareProbe: ShareProbe }).__shareProbe);
}

const SHARE_BUTTON = 'שתפו את הסקר עם חבר/ה';
const EXPECTED_PATH = '/research/alt-platforms-research?src=share-thanks';

test('the thank-you page shares the public survey link through the share sheet', async ({ page }) => {
  await installShareProbe(page, { withShareSheet: true });
  await gotoApp(page, '/research/thanks');

  await expect(page.getByText('תודה. ברצינות.')).toBeVisible();
  await expectNoRawI18nKeys(page);
  await page.getByRole('button', { name: SHARE_BUTTON }).click();

  await expect.poll(async () => (await readProbe(page)).shared.length).toBe(1);
  const [shared] = (await readProbe(page)).shared;
  expect(shared.url).toContain(EXPECTED_PATH);
  // The message body ends with the same attributed link.
  expect(shared.text).toContain(EXPECTED_PATH);
});

test('without a share sheet the thank-you page copies the survey link to the clipboard', async ({ page }) => {
  await installShareProbe(page, { withShareSheet: false });
  await gotoApp(page, '/research/thanks');

  await page.getByRole('button', { name: SHARE_BUTTON }).click();

  await expect.poll(async () => (await readProbe(page)).copied.length).toBe(1);
  const [copied] = (await readProbe(page)).copied;
  expect(copied).toContain(EXPECTED_PATH);
});
