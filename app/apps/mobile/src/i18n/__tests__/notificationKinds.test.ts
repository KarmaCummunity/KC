// Every notification kind of the database registry has all its app-side pieces.
//
// The table is NOTIFICATION_KIND_LIST, generated from `kc_private.notification_kinds`
// (scripts/generate-notification-kinds.mjs). A kind added in SQL therefore fails here until
// it has: Hebrew and English texts with arguments the renderers provide, a route, and a
// channel. Nothing in this file names a kind.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_CATEGORIES, NOTIFICATION_KIND_LIST, NOTIFICATION_TEXT_ARGS, notificationKindSpec,
  type NotificationKind,
} from '@kc/domain';
import he from '../locales/he';
import en from '../locales/en';
import { channelIdForKind, NOTIFICATION_CHANNELS } from '../../lib/notifications/channelSpec';
import { NOTIFICATION_ROUTES, resolveNotificationRoute, type NotificationTarget } from '../../lib/notifications/notificationRoutes';
import { notificationText } from '../../lib/notifications/notificationText';
import { toConcretePath } from '../../lib/notifications/tapRouting';

const APP_DIR = resolve(__dirname, '../../../app');
const UUID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ALLOWED_ARGS: readonly string[] = NOTIFICATION_TEXT_ARGS;

/** Looks a `notifications.fooTitle` key up in a locale bundle. */
function text(bundle: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node !== null && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    bundle,
  );
  return typeof value === 'string' ? value : undefined;
}
const placeholders = (value: string) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!);
const textKeys = (kind: NotificationKind) => {
  const spec = notificationKindSpec(kind);
  return [spec.titleKey, spec.bodyKey, ...(spec.groupedBodyKey ? [spec.groupedBodyKey] : [])];
};
/** i18next-style interpolation, strict: an argument that is not provided throws. */
const translate = (bundle: unknown) => (key: string, args: Record<string, string | number> = {}) => {
  const template = text(bundle, key);
  if (template === undefined) throw new Error(`missing text ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!(name in args)) throw new Error(`${key}: {{${name}}} is not provided`);
    return String(args[name]);
  });
};
/** A route file exists for the pathname (`/post/[id]` → app/post/[id].tsx or …/index.tsx). */
const routeFileExists = (pathname: string) =>
  ['.tsx', '/index.tsx'].some((suffix) => existsSync(resolve(APP_DIR, `.${pathname}${suffix}`)));

it('the generated kind list is present', () => {
  expect(NOTIFICATION_KIND_LIST.length).toBeGreaterThanOrEqual(57);
  expect(new Set(NOTIFICATION_KIND_LIST).size).toBe(NOTIFICATION_KIND_LIST.length);
});

describe.each(NOTIFICATION_KIND_LIST)('notification kind %s', (kind) => {
  const spec = notificationKindSpec(kind);

  it.each([['he', he], ['en', en]] as const)('has its texts in %s, using only the provided arguments', (_lang, bundle) => {
    for (const key of textKeys(kind)) {
      const value = text(bundle, key);
      expect(value, `${key} is missing`).toBeTruthy();
      for (const arg of placeholders(value!)) {
        expect(ALLOWED_ARGS, `${key} uses {{${arg}}}`).toContain(arg);
      }
    }
  });

  it('declares exactly the arguments its Hebrew texts use, and both languages agree', () => {
    const used = (bundle: unknown) => new Set(textKeys(kind).flatMap((key) => placeholders(text(bundle, key) ?? '')));
    expect([...used(he)].sort()).toEqual([...spec.textArgs].sort());
    expect([...used(en)].sort()).toEqual([...used(he)].sort());
  });

  it('groups iff it has a grouped body', () => {
    expect(spec.groupedBodyKey !== null).toBe(spec.groupWindowSeconds !== null);
  });

  it.each([1, 4])('renders in the notification centre with a group of %i', (groupCount) => {
    for (const bundle of [he, en]) {
      const row = { kind, titleKey: spec.titleKey, bodyKey: spec.bodyKey, groupCount, actorDisplayName: 'Dana' };
      const rendered = notificationText(row, translate(bundle));
      expect(rendered.title.trim()).not.toBe('');
      expect(rendered.body.trim()).not.toBe('');
      expect(`${rendered.title}${rendered.body}`).not.toContain('{{');
      const anonymous = notificationText({ ...row, actorDisplayName: null }, translate(bundle));
      expect(`${anonymous.title}${anonymous.body}`).not.toMatch(/null|undefined/);
    }
  });

  it('has a route builder that produces a typed route to an existing screen', () => {
    expect(NOTIFICATION_ROUTES[kind], 'no entry in NOTIFICATION_ROUTES').toBeTypeOf('function');
    const targets: NotificationTarget[] = [
      { entity: { type: 'chat', id: UUID }, args: { post_id: OTHER, message_id: OTHER } },
      { entity: { type: 'post_handoff', id: UUID }, args: { post_id: OTHER } },
      { entity: { type: 'post', id: UUID }, args: {} },
      { entity: null, args: {} },
    ];
    for (const target of targets) {
      const route = resolveNotificationRoute({ kind, ...target });
      expect(route, 'a tap always lands somewhere').not.toBeNull();
      expect(routeFileExists(route!.pathname), `${route!.pathname} is not a screen`).toBe(true);
      const dynamic = route!.pathname.split('/').filter((s) => s.startsWith('[')).map((s) => s.slice(1, -1));
      expect(Object.keys(route!.params).sort()).toEqual(dynamic.sort());
      expect(toConcretePath(route!)).not.toMatch(/\[|\/\/|\/$/);
      for (const value of Object.values(route!.params)) expect([UUID, OTHER]).toContain(value);
    }
  });

  it('opens its own target, not only the fallback, when the payload carries the ids', () => {
    const full = { entity: { type: 'chat', id: UUID }, args: { post_id: OTHER } };
    const built = NOTIFICATION_ROUTES[kind](full)
      ?? NOTIFICATION_ROUTES[kind]({ entity: { type: 'post', id: UUID }, args: {} })
      // A staff task notification names its task (FR-ADMIN-018).
      ?? NOTIFICATION_ROUTES[kind]({ entity: { type: 'admin_task', id: UUID }, args: {} });
    expect(built, 'the builder never produces a route').not.toBeNull();
  });

  it('is delivered on an existing channel / category', () => {
    const channel = channelIdForKind(kind);
    expect(NOTIFICATION_CATEGORIES).toContain(channel);
    expect(NOTIFICATION_CHANNELS[channel]).toBeDefined();
    expect(channel).toBe(spec.category);
  });
});

describe('channels and categories', () => {
  it.each(NOTIFICATION_CATEGORIES)('%s has a named channel in both languages', (category) => {
    const spec = NOTIFICATION_CHANNELS[category];
    for (const bundle of [he, en]) {
      expect(text(bundle, spec.nameKey)).toBeTruthy();
      expect(text(bundle, spec.descriptionKey)).toBeTruthy();
    }
  });

  it('only the critical channel interrupts', () => {
    expect(NOTIFICATION_CHANNELS.critical).toMatchObject({ importance: 'high', sound: true });
    expect(NOTIFICATION_CHANNELS.social).toMatchObject({ importance: 'default', sound: false });
    expect(Object.keys(NOTIFICATION_CHANNELS).sort()).toEqual([...NOTIFICATION_CATEGORIES].sort());
  });

  it('every pushed kind is on the interrupting channel or is social', () => {
    for (const kind of NOTIFICATION_KIND_LIST) {
      const spec = notificationKindSpec(kind);
      if (spec.bypassQuietHours || spec.bypassPreferences) expect(spec.category, kind).toBe('critical');
    }
  });
});

describe('resolveNotificationRoute', () => {
  it('ignores what is not a notification', () => {
    for (const value of [null, undefined, {}, { kind: 3 }, 'chat_message']) {
      expect(resolveNotificationRoute(value as never)).toBeNull();
    }
  });

  it('never takes a path or params from the payload', () => {
    const hostile = { kind: 'chat_message', route: '/settings', pathname: '/settings', params: { id: UUID }, entity: { type: 'chat', id: '../x' } };
    expect(resolveNotificationRoute(hostile as never)).toEqual({ pathname: '/notifications/inbox', params: {} });
    expect(resolveNotificationRoute({ kind: 'toString' })).toEqual({ pathname: '/notifications/inbox', params: {} });
  });

  it('builds the chat and post routes from shape-checked ids', () => {
    expect(resolveNotificationRoute({ kind: 'chat_message', entity: { type: 'chat', id: UUID } })).toEqual({
      pathname: '/chat/[id]', params: { id: UUID },
    });
    expect(resolveNotificationRoute({ kind: 'post_comment', entity: { type: 'comment', id: UUID }, args: { post_id: OTHER } })).toEqual({
      pathname: '/post/[id]', params: { id: OTHER },
    });
  });
});
