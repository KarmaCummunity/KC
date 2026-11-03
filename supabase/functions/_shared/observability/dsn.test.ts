import { assertEquals } from 'jsr:@std/assert@1';
import { parseDsn, SDK_NAME, SDK_VERSION, sentryAuthHeader } from './dsn.ts';

Deno.test('parseDsn: standard sentry.io DSN → envelope endpoint + public key', () => {
  const t = parseDsn('https://abc123@o4507.ingest.us.sentry.io/4509');
  assertEquals(t, {
    publicKey: 'abc123',
    projectId: '4509',
    envelopeUrl: 'https://o4507.ingest.us.sentry.io/api/4509/envelope/',
  });
});

Deno.test('parseDsn: self-hosted DSN keeps the path prefix before the project id', () => {
  const t = parseDsn('https://key@sentry.example.org/prefix/42');
  assertEquals(t?.envelopeUrl, 'https://sentry.example.org/prefix/api/42/envelope/');
});

Deno.test('parseDsn: empty, malformed or non-numeric project → null (reporting disabled, no throw)', () => {
  for (const bad of [undefined, null, '', '   ', 'not a url', 'https://host/123', 'https://key@host/', 'https://key@host/abc', 'ftp://key@host/1']) {
    assertEquals(parseDsn(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

Deno.test('sentryAuthHeader: protocol v7 with the public key only', () => {
  const t = parseDsn('https://pk@host/7')!;
  assertEquals(sentryAuthHeader(t), `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=pk`);
});
