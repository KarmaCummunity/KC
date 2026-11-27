import type { FastifyReply, FastifyRequest } from 'fastify';
import type { HttpAnswer } from '../http/httpAnswer';

/** The request headers a webhook reads: lookup by lower-case name. */
export interface WebhookHeaders {
  get(name: string): string | null;
}

/**
 * What a webhook handler works on. A provider cannot send a member token, so
 * a webhook authenticates the request itself, and a signature covers the body
 * exactly as it was received: handlers get the raw text, never a parsed copy.
 */
export interface WebhookRequest {
  readonly headers: WebhookHeaders;
  readonly rawBody: string;
}

/** A request whose raw body the app kept (`rawBody: true` in `createApp`). */
export type RawBodyRequest = FastifyRequest & { rawBody?: Buffer };

/** The webhook view of an HTTP request. A repeated header reads as its first value. */
export function readWebhook(request: RawBodyRequest): WebhookRequest {
  return {
    headers: {
      get(name) {
        const value = request.headers[name];
        return (Array.isArray(value) ? value[0] : value) ?? null;
      },
    },
    rawBody: request.rawBody?.toString('utf8') ?? '',
  };
}

/**
 * Sends a webhook's answer as it is: the status and body are the provider's
 * protocol (a provider resends on a non-2xx), not the API's error format.
 * @returns The body, for the route to return.
 */
export function sendAnswer(reply: FastifyReply, answer: HttpAnswer): unknown {
  void reply.status(answer.status);
  return answer.body;
}
