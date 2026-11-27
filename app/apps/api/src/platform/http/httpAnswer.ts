/**
 * An HTTP status with a JSON body, decided by a pure function and sent by a
 * thin route. Used where the answer is someone else's protocol (a ported Edge
 * Function, a provider's webhook) and so is not the API's own error format.
 */
export interface HttpAnswer {
  readonly status: number;
  readonly body: unknown;
}
