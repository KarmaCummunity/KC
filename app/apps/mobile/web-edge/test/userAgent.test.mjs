import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUserAgent } from '../src/userAgent.mjs';
import { decideSharedLinkAction } from '../src/sharedLinkPolicy.mjs';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const INSTAGRAM = `${IPHONE} Instagram 300.0`;
const FACEBOOK_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0]';

describe('classifyUserAgent', () => {
  it('recognises link-preview crawlers', () => {
    for (const ua of ['WhatsApp/2.23.20', 'facebookexternalhit/1.1', 'TelegramBot (like TwitterBot)', 'Slackbot-LinkExpanding 1.0', 'Mozilla/5.0 (compatible; Discordbot/2.0)']) {
      assert.equal(classifyUserAgent(ua), 'crawler', ua);
    }
  });
  it('recognises phone browsers', () => {
    assert.equal(classifyUserAgent(IPHONE), 'ios');
    assert.equal(classifyUserAgent(ANDROID), 'android');
  });
  it('treats desktop, empty and unknown agents as web', () => {
    assert.equal(classifyUserAgent(DESKTOP), 'web');
    assert.equal(classifyUserAgent(''), 'web');
    assert.equal(classifyUserAgent(null), 'web');
  });
  it('never classifies an in-app browser as a phone browser (universal links do not fire there)', () => {
    assert.equal(classifyUserAgent(INSTAGRAM), 'web');
    assert.equal(classifyUserAgent(FACEBOOK_WEBVIEW), 'web');
  });
});

describe('decideSharedLinkAction', () => {
  const stores = { ios: 'https://apps.apple.com/app/id1', android: 'https://play.google.com/store/apps/details?id=x' };
  const none = { ios: '', android: '' };
  const q = (s = '') => new URLSearchParams(s);

  it('answers a crawler with the card, even when a store is configured', () => {
    assert.deepEqual(decideSharedLinkAction({ userAgent: 'WhatsApp/2.0', search: q(), storeLinks: stores }), { kind: 'og' });
  });
  it('sends an iPhone to the App Store and an Android phone to Google Play', () => {
    assert.deepEqual(decideSharedLinkAction({ userAgent: IPHONE, search: q(), storeLinks: stores }), { kind: 'store', url: stores.ios });
    assert.deepEqual(decideSharedLinkAction({ userAgent: ANDROID, search: q(), storeLinks: stores }), { kind: 'store', url: stores.android });
  });
  it('keeps a phone on the web when its store is not configured', () => {
    assert.deepEqual(decideSharedLinkAction({ userAgent: IPHONE, search: q(), storeLinks: { ios: '', android: stores.android } }), { kind: 'web' });
    assert.deepEqual(decideSharedLinkAction({ userAgent: ANDROID, search: q(), storeLinks: none }), { kind: 'web' });
  });
  it('honours ?web=1 as the way to stay on the website', () => {
    assert.deepEqual(decideSharedLinkAction({ userAgent: IPHONE, search: q('web=1'), storeLinks: stores }), { kind: 'web' });
  });
  it('keeps desktop on the web', () => {
    assert.deepEqual(decideSharedLinkAction({ userAgent: DESKTOP, search: q(), storeLinks: stores }), { kind: 'web' });
  });
});
