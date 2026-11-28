import { Inject, Injectable } from '@nestjs/common';
import type { InProcessFunctions } from '../postgrest/sqlBackedClient';
import { type FunctionRequest, HOSTED_FUNCTIONS, type HostedFunction } from './hostedFunction';

/** Two hosted functions claim the same name. */
export class DuplicateHostedFunctionError extends Error {
  constructor(name: string) {
    super(`hosted function "${name}" is registered twice`);
    this.name = 'DuplicateHostedFunctionError';
  }
}

/**
 * The registry of the Edge Functions this server has taken over. It knows no
 * function by itself: each module contributes its own (`HOSTED_FUNCTIONS`),
 * and this class only binds them to the request an adapter runs in.
 */
@Injectable()
export class HostedFunctions {
  private readonly byName: ReadonlyMap<string, HostedFunction>;

  constructor(@Inject(HOSTED_FUNCTIONS) functions: readonly HostedFunction[]) {
    const byName = new Map<string, HostedFunction>();
    for (const hosted of functions) {
      // A second registration would silently replace the first; fail at start-up instead.
      if (byName.has(hosted.name)) throw new DuplicateHostedFunctionError(hosted.name);
      byName.set(hosted.name, hosted);
    }
    this.byName = byName;
  }

  /** Every function, as the adapters of `request` may invoke it. */
  forRequest(request: FunctionRequest): InProcessFunctions {
    const bound: Record<string, InProcessFunctions[string]> = {};
    for (const [name, hosted] of this.byName) {
      bound[name] = (body) => hosted.handle(request, body);
    }
    return bound;
  }
}
