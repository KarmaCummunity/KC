// Focused DEV-only proof. No post publication, account changes, chat messages or store actions.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL, SUPABASE_URL, USER_D, anonKey } from '../lib/env';
import { sessionFor } from '../lib/api';
import { dismissGates } from '../lib/app';

const HERE = path.dirname(fileURLToPath(import.meta.url));
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', video: 'off' });

test('deployed post-photo picker stores full and thumb, displays the selection and cleans only its own files', async ({ page }, info) => {
  test.setTimeout(120_000);
  expect(BASE_URL).toBe('https://dev.karma-community.pages.dev');
  expect(SUPABASE_URL).toBe('https://enbqriuxvvuontiwslun.supabase.co');
  const { storageKey, session } = await sessionFor(USER_D);
  const userId = (session.user as { id: string }).id;
  const token = session.access_token as string;
  const paths = new Set<string>();
  const uploads: { path: string; status: number }[] = [];
  page.on('response', response => {
    const request = response.request();
    const prefix = `${SUPABASE_URL}/storage/v1/object/post-images/`;
    if (request.method() === 'POST' && response.url().startsWith(prefix)) {
      const objectPath = decodeURIComponent(response.url().slice(prefix.length).split('?')[0]!);
      if (objectPath.startsWith(`${userId}/`)) {
        paths.add(objectPath);
        uploads.push({ path: objectPath, status: response.status() });
      }
    }
  });
  try {
    await page.goto('/');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: session });
    // Items uses the immediate post-image uploader. Food is a different engine that uploads on publish.
    await page.goto('/create?category=items');
    await dismissGates(page);
    const add = page.getByRole('button', { name: 'הוסיפו תמונה' }).first();
    await expect(add).toBeVisible({ timeout: 45_000 });
    const chooser = page.waitForEvent('filechooser');
    await add.click();
    await (await chooser).setFiles(path.join(HERE, '../fixtures/item.png'));
    await expect.poll(() => uploads.filter(x => x.status === 200).length, { timeout: 60_000 }).toBe(2);
    expect(uploads.every(x => x.status === 200)).toBe(true);
    expect([...paths].some(x => x.endsWith('-thumb.jpg'))).toBe(true);
    const remove = page.getByRole('button', { name: 'הסירו תמונה' }).first();
    await expect(remove).toBeVisible();
    const selectedImage = remove.locator('..').locator('img').first();
    await expect(selectedImage).toBeVisible();
    await expect.poll(() => selectedImage.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: info.outputPath('media-picker-live.png'), fullPage: true });
    for (const objectPath of paths) {
      const response = await page.request.get(`${SUPABASE_URL}/storage/v1/object/public/post-images/${objectPath}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('image/jpeg');
      expect((await response.body()).length).toBeGreaterThan(0);
    }
    await info.attach('acceptance-scope', { body: JSON.stringify({ uploads: uploads.length, storedFullAndThumb: true, published: false, client: 'deployed web', nativeProof: false }), contentType: 'application/json' });
  } finally {
    if (!page.isClosed()) {
      await page.screenshot({ path: info.outputPath('media-picker-final.png'), fullPage: true }).catch(() => {});
    }
    await page.close();
    if (paths.size > 0) {
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/post-images`, {
        method: 'DELETE', headers: { apikey: await anonKey(), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [...paths] }),
      });
      expect(response.status(), 'exact observed test uploads cleaned').toBe(200);
    }
  }
});

test('deployed crawler preview returns a bounded image or the logo for an existing public post', async ({ request }) => {
  const key = await anonKey();
  const feed = await request.get(`${SUPABASE_URL}/rest/v1/rpc/guest_posts?p_limit=1`, { headers: { apikey: key } });
  expect(feed.status()).toBe(200);
  const rows = await feed.json() as { id: string }[];
  expect(rows.length).toBe(1);
  const preview = await request.get(`${BASE_URL}/post/${rows[0]!.id}`, { headers: { 'User-Agent': 'WhatsApp/2.0' } });
  expect(preview.status()).toBe(200);
  const html = await preview.text();
  expect(html).toContain('og:image');
  const image = html.match(/property="og:image" content="([^"]+)"/);
  expect(image).not.toBeNull();
  const result = await request.get(image![1]!.replaceAll('&amp;', '&'));
  expect(result.status()).toBe(200);
  expect((await result.body()).length).toBeLessThanOrEqual(300 * 1024);
  // This probes the HTTP crawler contract, not a real WhatsApp client's rendering.
});
