import { expect, type Page } from '@playwright/test';

/** Dismiss legal/consent gates that can appear on first load. */
export async function dismissGates(page: Page) {
  for (const name of ['המשך', 'אישור', 'Continue', 'OK']) {
    const b = page.getByRole('button', { name, exact: true });
    if (await b.isVisible({ timeout: 1_500 }).catch(() => false)) await b.click();
  }
}

/** Collect failed Supabase calls (4xx/5xx) so specs can assert there are none. */
export function trackApiErrors(page: Page) {
  const errors: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('.supabase.co/')) {
      errors.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`);
    }
  });
  return errors;
}

/** Raw i18n keys like `donations.marketplaceHubTitle` leaking into the UI. */
export async function expectNoRawI18nKeys(page: Page) {
  const body = await page.locator('body').innerText();
  const leaks = body.match(/\b(?:donations|marketplace|givingHandoff|post|feed|chat|notifications|settings|matches)\.[a-z][A-Za-z]+(?:\.[A-Za-z]+)*\b/g) ?? [];
  expect(leaks, `raw i18n keys on ${page.url()}`).toEqual([]);
}

/**
 * FR-AUTH-010 AC2.d: a member without a date of birth is asked for it before an action (e.g.
 * publishing). Seed users may have none, so fill an adult date once when the gate shows.
 * Returns whether the gate was shown.
 */
export async function passDateOfBirthGate(page: Page): Promise<boolean> {
  const gate = page.getByText('עוד פרט אחד לפני שממשיכים');
  // isVisible() does not wait; give the gate (opened after the publish tap) a few seconds.
  const shown = await gate
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await page.getByRole('textbox', { name: 'יום' }).fill('1');
  await page.getByRole('textbox', { name: 'חודש' }).fill('1');
  await page.getByRole('textbox', { name: 'שנה' }).fill('1990');
  await page.getByRole('button', { name: 'שמירה והמשך' }).click();
  await expect(gate).toHaveCount(0, { timeout: 15_000 });
  return true;
}

export async function gotoApp(page: Page, path: string) {
  await page.goto(path);
  await dismissGates(page);
}
