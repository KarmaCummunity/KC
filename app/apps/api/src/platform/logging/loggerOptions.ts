import type { FastifyServerOptions } from 'fastify';
import type { ApiConfig } from '../config/apiConfig';

/** The logger configuration Fastify takes: `false` for none, or the options of its built-in JSON logger. */
type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean | undefined> | false;

/**
 * How Google Cloud's log viewer names each level. It reads the field
 * `severity`; without it every line, an error included, is filed as
 * "default" and no alert or error report can be built on the logs.
 */
const CLOUD_SEVERITY: Readonly<Record<string, string>> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * The path of a request without its query string. A query can carry a
 * credential of the request itself (a signed address, a provider's
 * verification token), and a log line outlives the request.
 */
export function pathOnly(url: string | undefined): string {
  if (!url) return '';
  const end = url.indexOf('?');
  return end === -1 ? url : url.slice(0, end);
}

/**
 * The one log format of the API: JSON lines on standard output, readable as
 * they are and understood by Google Cloud's log viewer (`severity`,
 * `message`). Silent in tests, to keep their output readable.
 */
export function loggerOptions(config: Pick<ApiConfig, 'environment'>): LoggerOptions {
  if (config.environment === 'test') return false;
  return {
    messageKey: 'message',
    formatters: {
      // The numeric level stays for tools that filter on it.
      level: (label, level) => ({ severity: CLOUD_SEVERITY[label] ?? 'DEFAULT', level }),
    },
    serializers: {
      req: (request) => ({
        method: request.method,
        url: pathOnly(request.url),
        host: request.host,
        remoteAddress: request.ip,
        remotePort: request.socket?.remotePort,
      }),
    },
  };
}
