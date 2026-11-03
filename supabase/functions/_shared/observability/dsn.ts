// _shared/observability/dsn.ts
// Sentry DSN parsing for the dependency-free envelope client (G41).
// A DSN looks like `https://<publicKey>@<host>[/<prefix>]/<projectId>`; events are
// POSTed to `<scheme>://<host>[/<prefix>]/api/<projectId>/envelope/`.

/** Identifier this client reports to Sentry as (`sdk.name` + `sentry_client`). */
export const SDK_NAME = 'kc.edge-observability';
export const SDK_VERSION = '1.0.0';

export interface SentryTarget {
  /** Public key from the DSN user-info part. DSNs carry no secret key. */
  readonly publicKey: string;
  /** Numeric Sentry project id (last DSN path segment). */
  readonly projectId: string;
  /** Fully qualified envelope endpoint for this project. */
  readonly envelopeUrl: string;
}

/**
 * Parses a DSN into its envelope endpoint. Returns `null` for an empty or
 * malformed value so a bad secret disables reporting instead of crashing a function.
 */
export function parseDsn(dsn: string | null | undefined): SentryTarget | null {
  const raw = (dsn ?? '').trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  if (!url.username || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = segments.length ? `/${segments.join('/')}` : '';
  return {
    publicKey: url.username,
    projectId,
    envelopeUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

/** Value of the `X-Sentry-Auth` header (protocol v7, public-key auth). */
export function sentryAuthHeader(target: SentryTarget): string {
  return `Sentry sentry_version=7, sentry_client=${SDK_NAME}/${SDK_VERSION}, sentry_key=${target.publicKey}`;
}
