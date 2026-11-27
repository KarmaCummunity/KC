import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenericCard, buildPostCard, buildProfileCard, resolveWorld } from '../src/ogCard.mjs';
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

describe('card image', () => {
  const logo = { url: 'https://karma-community-kc.com/pwa-icon-512.png', type: 'image/png', width: 512, height: 512 };
  it('uses the image it is given, else the logo', () => {
    const chosen = { url: 'https://proj.supabase.co/x-thumb.jpg', type: 'image/jpeg', width: 400, height: 300 };
    assert.deepEqual(buildPostCard(row(), config, chosen).image, chosen);
    assert.deepEqual(buildPostCard(row(), config).image, logo);
    assert.deepEqual(buildGenericCard(config).image, logo);
    assert.deepEqual(buildProfileCard(config).image, logo);
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
    const image = { url: 'https://i/x.png?a=1&b=2', type: 'image/png', width: 512, height: 512 };
    const html = renderOgHtml({ title: '<b>"x"</b>', description: "a&b'", image }, 'https://s/post/1');
    assert.ok(!html.includes('<b>'));
    assert.ok(html.includes('&lt;b&gt;&quot;x&quot;&lt;/b&gt;'));
    assert.ok(html.includes('a&amp;b&#39;'));
    assert.ok(html.includes('og:image" content="https://i/x.png?a=1&amp;b=2"'));
  });
  it('describes the image: secure URL, type and measured size', () => {
    const html = renderOgHtml({ title: 't', description: 'd', image: { url: 'https://i/x.jpg', type: 'image/jpeg', width: 400, height: 300 } }, 'https://s/post/1');
    assert.ok(html.includes('og:image:secure_url" content="https://i/x.jpg"'));
    assert.ok(html.includes('og:image:type" content="image/jpeg"'));
    assert.ok(html.includes('og:image:width" content="400"'));
    assert.ok(html.includes('og:image:height" content="300"'));
    assert.ok(html.includes('twitter:image" content="https://i/x.jpg"'));
  });
  it('omits width and height it did not measure, and secure_url for a non-https URL', () => {
    const html = renderOgHtml({ title: 't', description: 'd', image: { url: 'http://i/x.jpg', type: 'image/jpeg', width: null, height: null } }, 'https://s/post/1');
    assert.ok(!html.includes('og:image:width'));
    assert.ok(!html.includes('og:image:secure_url'));
  });
});
