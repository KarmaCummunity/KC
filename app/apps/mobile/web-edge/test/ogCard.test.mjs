import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenericCard, buildPostCard, buildProfileCard, resolveImageUrl, resolveWorld } from '../src/ogCard.mjs';
import { renderOgHtml } from '../src/ogHtml.mjs';
import { he } from '../i18n/he.mjs';

const config = { supabaseUrl: 'https://proj.supabase.co', appBaseUrl: 'https://karma-community-kc.com' };
const row = (patch = {}) => ({ title: 'שולחן עץ', description: 'במצב מצוין', direction: 'offer', status: 'open', world_slug: 'items', city_name_he: 'תל אביב', cover_bucket: null, cover_key: null, ...patch });

describe('resolveWorld', () => {
  it('maps a missing slug to items, known slugs to themselves and unknown slugs to generic', () => {
    assert.equal(resolveWorld(null), 'items');
    assert.equal(resolveWorld('rides'), 'rides');
    assert.equal(resolveWorld('medical'), 'generic');
  });
});

describe('buildPostCard', () => {
  it('titles the card by world and direction, not with the item template', () => {
    const ride = buildPostCard(row({ world_slug: 'rides', direction: 'offer', title: 'נוסע/ת מירושלים להוד השרון' }), config);
    assert.equal(ride.title, `${he.titlePrefix.rides.offer} · נוסע/ת מירושלים להוד השרון`);
    const wanted = buildPostCard(row({ world_slug: 'rides', direction: 'request' }), config);
    assert.ok(wanted.title.startsWith(he.titlePrefix.rides.request));
    assert.ok(!ride.title.includes(he.titlePrefix.items.offer));
  });
  it('leads a closed post with the check mark', () => {
    assert.ok(buildPostCard(row({ status: 'closed_delivered' }), config).title.startsWith(he.closedPrefix));
  });
  it('uses the post description plus the city, or the world fallback when there is none', () => {
    assert.ok(buildPostCard(row(), config).description.startsWith('במצב מצוין'));
    assert.ok(buildPostCard(row(), config).description.endsWith('📍 תל אביב'));
    const empty = buildPostCard(row({ description: '  ', world_slug: 'food', direction: 'request', city_name_he: null }), config);
    assert.equal(empty.description, he.fallbackDescription.food.request);
  });
  it('truncates long titles and descriptions', () => {
    const card = buildPostCard(row({ title: 'א'.repeat(300), description: 'ב'.repeat(900) }), config);
    assert.ok(card.title.length <= 70 && card.title.endsWith('…'));
    assert.ok(card.description.length <= 200 && card.description.endsWith('…'));
  });
});

describe('resolveImageUrl', () => {
  it('builds the public URL of the cover in the media bucket, encoding each path segment', () => {
    assert.equal(
      resolveImageUrl({ cover_bucket: 'post-images', cover_key: 'u/a b.jpg' }, config),
      'https://proj.supabase.co/storage/v1/object/public/post-images/u/a%20b.jpg',
    );
  });
  it('falls back to the logo for no cover, a foreign bucket or missing config', () => {
    const logo = 'https://karma-community-kc.com/pwa-icon-512.png';
    assert.equal(resolveImageUrl({ cover_bucket: null, cover_key: null }, config), logo);
    assert.equal(resolveImageUrl({ cover_bucket: 'chat-media', cover_key: 'x.jpg' }, config), logo);
    assert.equal(resolveImageUrl({ cover_bucket: 'post-images', cover_key: 'x.jpg' }, { ...config, supabaseUrl: '' }), logo);
  });
});

describe('generic and profile cards', () => {
  it('carry no post data', () => {
    assert.equal(buildGenericCard(config).title, he.appName);
    assert.equal(buildProfileCard(config).title, he.profileTitle);
  });
});

describe('renderOgHtml', () => {
  it('escapes user input in every attribute', () => {
    const html = renderOgHtml({ title: '<b>"x"</b>', description: "a&b'", imageUrl: 'https://i/x.png?a=1&b=2' }, 'https://s/post/1');
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
    assert.ok(html.includes('a&amp;b&#39;'));
    assert.ok(html.includes('og:image" content="https://i/x.png?a=1&amp;b=2"'));
  });
});
