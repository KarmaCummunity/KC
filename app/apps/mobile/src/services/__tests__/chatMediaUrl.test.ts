import { describe, it, expect, vi } from 'vitest';
import { getSupabaseClient } from '@kc/infrastructure-supabase';

vi.mock('@kc/infrastructure-supabase', () => ({ getSupabaseClient: vi.fn() }));

import {
  chatImagePath,
  createChatMediaUrlResolver,
  resolveChatMediaUrl,
  SIGNED_URL_TTL_SECONDS,
} from '../chatMediaUrl';

const PATH = 'u1/c1/obj-1.jpg';

/** A clock the test moves by hand. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('createChatMediaUrlResolver', () => {
  it('signs the path once for the URL lifetime and serves the cached URL afterwards', async () => {
    const sign = vi.fn(async (path: string) => `https://signed/${path}?t=1`);
    const resolve = createChatMediaUrlResolver(sign, fakeClock().now);

    await expect(resolve(PATH)).resolves.toBe(`https://signed/${PATH}?t=1`);
    await expect(resolve(PATH)).resolves.toBe(`https://signed/${PATH}?t=1`);

    expect(sign).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledWith(PATH, SIGNED_URL_TTL_SECONDS);
  });

  it('shares one Storage call between concurrent requests for the same path', async () => {
    let release: (url: string) => void = () => undefined;
    const sign = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const resolve = createChatMediaUrlResolver(sign, fakeClock().now);

    const first = resolve(PATH);
    const second = resolve(PATH);
    release('https://signed/once');

    await expect(Promise.all([first, second])).resolves.toEqual(['https://signed/once', 'https://signed/once']);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('renews the URL shortly before it expires', async () => {
    const clock = fakeClock();
    let n = 0;
    const sign = vi.fn(async () => `https://signed/${++n}`);
    const resolve = createChatMediaUrlResolver(sign, clock.now);

    await expect(resolve(PATH)).resolves.toBe('https://signed/1');
    clock.advance(SIGNED_URL_TTL_SECONDS * 1000 - 10 * 60 * 1000); // 10 minutes left: still cached
    await expect(resolve(PATH)).resolves.toBe('https://signed/1');
    clock.advance(6 * 60 * 1000); // 4 minutes left: inside the renewal window
    await expect(resolve(PATH)).resolves.toBe('https://signed/2');
    expect(sign).toHaveBeenCalledTimes(2);
  });

  it('returns null without caching when Storage refuses or fails, so the next render retries', async () => {
    const sign = vi
      .fn<(path: string, ttl: number) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('https://signed/ok');
    const resolve = createChatMediaUrlResolver(sign, fakeClock().now);

    await expect(resolve(PATH)).resolves.toBeNull();
    await expect(resolve(PATH)).resolves.toBeNull();
    await expect(resolve(PATH)).resolves.toBe('https://signed/ok');
    expect(sign).toHaveBeenCalledTimes(3);
  });
});

describe('chatImagePath', () => {
  it('returns the object path of an image payload', () => {
    expect(chatImagePath({ type: 'image', path: PATH, width: 800, height: 600 })).toBe(PATH);
  });

  it('ignores the legacy public url and returns null without a path', () => {
    expect(chatImagePath({ type: 'image', url: 'https://cdn/public/x.jpg' })).toBeNull();
    expect(chatImagePath({ type: 'image', path: '' })).toBeNull();
  });

  it('returns null for other media types and for no payload', () => {
    expect(chatImagePath({ type: 'location', path: PATH })).toBeNull();
    expect(chatImagePath(null)).toBeNull();
  });
});

describe('default resolveChatMediaUrl with supabase', () => {
  it('calls supabase storage createSignedUrl and returns signed url', async () => {
    const mockCreateSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://storage/signed/default.jpg' },
      error: null,
    });
    vi.mocked(getSupabaseClient).mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mockCreateSignedUrl,
        })),
      },
    } as never);

    const url = await resolveChatMediaUrl('unique-path-1.jpg');

    expect(url).toBe('https://storage/signed/default.jpg');
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('unique-path-1.jpg', SIGNED_URL_TTL_SECONDS);
  });

  it('returns null when supabase storage returns an error', async () => {
    const mockCreateSignedUrl = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Not allowed' },
    });
    vi.mocked(getSupabaseClient).mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: mockCreateSignedUrl,
        })),
      },
    } as never);

    const url = await resolveChatMediaUrl('unique-path-error.jpg');
    expect(url).toBeNull();
  });
});
