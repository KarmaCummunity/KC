import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import {
  buildExceptionEvent,
  buildMessageEvent,
  type EventContext,
  parseStack,
  sanitizeUrl,
  serializeEnvelope,
} from './event.ts';

const ctx: EventContext = {
  environment: 'test',
  release: 'functions@abc',
  tags: { edge_function: 'f', handled: 'false' },
  request: { method: 'POST', url: 'https://x/functions/v1/f' },
};
const NOW = new Date('2026-10-31T10:00:00.000Z');

Deno.test('parseStack: V8 frames become Sentry frames, oldest first, in_app only for file:// modules', () => {
  const stack = [
    'TypeError: boom',
    '    at inner (file:///home/kc/supabase/functions/f/index.ts:10:7)',
    '    at async outer (file:///home/kc/supabase/functions/_shared/x.ts:20:3)',
    '    at https://esm.sh/@supabase/supabase-js@2.45.4/es2022/supabase-js.mjs:1:100',
    '    at ext:core/01_core.js:5:5',
    'not a frame line',
  ].join('\n');
  const frames = parseStack(stack);
  assertEquals(frames.length, 4);
  assertEquals(frames[0], { function: '<anonymous>', filename: 'ext:core/01_core.js', lineno: 5, colno: 5, in_app: false });
  assertEquals(frames[1].in_app, false);
  assertEquals(frames[2], {
    function: 'outer',
    filename: 'file:///home/kc/supabase/functions/_shared/x.ts',
    lineno: 20,
    colno: 3,
    in_app: true,
  });
  assertEquals(frames[3].function, 'inner');
  assertEquals(parseStack(undefined), []);
});

Deno.test('sanitizeUrl: query string and fragment are dropped', () => {
  assertEquals(sanitizeUrl('https://x/functions/v1/f?token=secret#frag'), 'https://x/functions/v1/f');
  assertEquals(sanitizeUrl('garbage'), 'garbage');
});

Deno.test('buildExceptionEvent: Error → exception with type, message, frames and mechanism', () => {
  const err = new RangeError('out of range');
  const ev = buildExceptionEvent(err, false, ctx, NOW);
  assertMatch(ev.event_id, /^[0-9a-f]{32}$/);
  assertEquals(ev.timestamp, '2026-10-31T10:00:00.000Z');
  assertEquals(ev.level, 'error');
  assertEquals(ev.environment, 'test');
  assertEquals(ev.release, 'functions@abc');
  assertEquals(ev.request, ctx.request);
  const value = ev.exception!.values[0];
  assertEquals(value.type, 'RangeError');
  assertEquals(value.value, 'out of range');
  assertEquals(value.mechanism, { type: 'kc.edge-observability', handled: false });
  assert((value.stacktrace?.frames.length ?? 0) > 0, 'frames expected from a real Error');
});

Deno.test('buildExceptionEvent: PostgREST-style plain object and non-error values are described without frames', () => {
  const pg = buildExceptionEvent({ message: 'relation missing', code: '42P01' }, true, ctx, NOW);
  assertEquals(pg.exception!.values[0].type, 'Error[42P01]');
  assertEquals(pg.exception!.values[0].value, 'relation missing');
  assertEquals(pg.exception!.values[0].stacktrace, undefined);

  const str = buildExceptionEvent('plain string', true, ctx, NOW);
  assertEquals(str.exception!.values[0], {
    type: 'NonError',
    value: 'plain string',
    mechanism: { type: 'kc.edge-observability', handled: true },
  });
});

Deno.test('buildExceptionEvent: very long messages are truncated, empty extra is omitted', () => {
  const ev = buildExceptionEvent(new Error('x'.repeat(5000)), true, { ...ctx, extra: {} }, NOW);
  assertEquals(ev.exception!.values[0].value.length, 1001);
  assertEquals(ev.extra, undefined);
});

Deno.test('buildMessageEvent: message events carry the formatted text and the level', () => {
  const ev = buildMessageEvent('f responded 502 (provider_failed)', 'error', { ...ctx, extra: { a: 1 } }, NOW);
  assertEquals(ev.message, { formatted: 'f responded 502 (provider_failed)' });
  assertEquals(ev.exception, undefined);
  assertEquals(ev.extra, { a: 1 });
});

Deno.test('serializeEnvelope: three newline-terminated JSON lines (header, item header, payload)', () => {
  const ev = buildMessageEvent('hello', 'info', ctx, NOW);
  const dsn = 'https://k@host/1';
  const lines = serializeEnvelope(ev, dsn, NOW).split('\n');
  assertEquals(lines.length, 4);
  assertEquals(lines[3], '');
  assertEquals(JSON.parse(lines[0]).event_id, ev.event_id);
  assertEquals(JSON.parse(lines[0]).dsn, dsn);
  assertEquals(JSON.parse(lines[0]).sent_at, '2026-10-31T10:00:00.000Z');
  assertEquals(JSON.parse(lines[1]), { type: 'event', content_type: 'application/json' });
  assertEquals(JSON.parse(lines[2]), ev);
});
