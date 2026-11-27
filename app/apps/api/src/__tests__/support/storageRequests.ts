import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** The path and query of a URL the store handed out: tests inject requests, so no port is open. */
export function pathOf(url: string): string {
  const { pathname, search } = new URL(url);
  return pathname + search;
}

/**
 * A `fetch` answered by the application in process, for a client that takes
 * one: the client and the server meet without a port being opened. Only the
 * path and query of the address are used.
 */
export function injectFetch(app: NestFastifyApplication): typeof fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const response = await app.inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'PUT',
      url: pathOf(String(input)),
      headers: Object.fromEntries(new Headers(init.headers)),
      payload: typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array),
    });
    return new Response(new Uint8Array(response.rawPayload), { status: response.statusCode, headers: response.headers as Record<string, string> });
  }) as typeof fetch;
}
