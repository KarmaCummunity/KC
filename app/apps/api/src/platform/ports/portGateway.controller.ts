import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import {
  decodeArgs,
  markDates,
  MAX_PORT_ARGS,
  PORT_ERROR_CODE,
  type PortCallResponse,
  type PortManifest,
  reviveDates,
  serializePortError,
} from '@kc/infrastructure-api';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors/ApiError';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../identity/accessTokenVerifier';
import { resolveCaller } from '../identity/resolveCaller';
import { UnsupportedSupabaseServiceError } from '../postgrest/sqlBackedClient';
import { RateLimiter } from '../rateLimit/rateLimiter';
import { findArgsProblem, type PortArgShapes } from './argShapes';
import generatedArgShapes from './portArgShapes.generated.json';
import { PortClients } from './portClients';
import type { PortAccess, PortDefinition } from './portDefinition';
import { VisitorCache } from './visitorCache';

/** Argument shapes of every catalog port method, generated from the port interfaces. */
const ARG_SHAPES = generatedArgShapes as unknown as PortArgShapes;

/**
 * Methods whose arguments or result hold a `Date` (generated from the port
 * interfaces). JSON has no date type, so these alone are passed through the
 * date marking of the wire format; every other call skips that walk.
 */
const TYPED_METHODS = new Set(ARG_SHAPES.typedMethods);

/** Injection token of the served ports, by wire name. */
export const PORT_DEFINITIONS = Symbol('PORT_DEFINITIONS');

function readArgs(body: unknown): unknown[] {
  const { args, typed } = (body ?? {}) as { args?: unknown; typed?: unknown };
  if (!Array.isArray(args) || args.length > MAX_PORT_ARGS) {
    throw new ApiError('bad_request', 400, 'a port call body is { "args": [...] }');
  }
  const decoded = decodeArgs(args);
  return typed === true ? (reviveDates(decoded) as unknown[]) : decoded;
}

/** The body of a successful call. `typed` tells the app to turn marked dates back into dates. */
function answer(result: unknown, typed: boolean): PortCallResponse {
  if (result === undefined) return {};
  return typed ? { result, typed: true } : { result };
}

/**
 * The one route the app's data access goes through (ADR-010): it calls a
 * method of an application port, and the gateway runs that method on the
 * server as the caller. Only methods a port definition lists can be called.
 */
@Controller('ports')
export class PortGatewayController {
  constructor(
    @Inject(PORT_DEFINITIONS) private readonly ports: ReadonlyMap<string, PortDefinition>,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(RateLimiter) private readonly rateLimiter: RateLimiter,
    @Inject(VisitorCache) private readonly visitorCache: VisitorCache,
  ) {}

  /**
   * What this API serves, for the app's router. Listing is not access: a
   * `member` method still needs a token when it is called.
   */
  @Get()
  manifest(): PortManifest {
    const ports: Record<string, string[]> = {};
    for (const [name, port] of this.ports) {
      ports[name] = Object.keys(port.methods).filter((method) => port.methods[method] !== 'not_served');
    }
    return { ports };
  }

  @Post(':port/:method')
  @HttpCode(200)
  async call(
    @Param('port') portName: string,
    @Param('method') method: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PortCallResponse> {
    const port = this.ports.get(portName);
    const access = port ? this.accessOf(port, method) : undefined;
    if (!port || !access) throw new ApiError('port_method_not_found', 404, `${portName}.${method}`);
    if (access === 'not_served') throw new ApiError('port_method_not_served', 501, `${portName}.${method}`);

    const caller = await resolveCaller(request, this.verifier);
    if (access === 'member' && !caller) throw new ApiError('unauthorized', 401, 'no bearer token');

    // A member is counted wherever they call from; a visitor by address.
    const limit = await this.rateLimiter.check(caller ? `user:${caller.userId}` : `ip:${request.ip}`);
    if (!limit.allowed) {
      reply.header('retry-after', limit.retryAfterSeconds);
      throw new ApiError('too_many_requests', 429, `${portName}.${method}`);
    }
    const args = readArgs(body);
    // A port outside the catalog (a test double) has no generated shapes and is not checked.
    const parameters = ARG_SHAPES.ports[portName]?.[method];
    const problem = parameters ? findArgsProblem(args, parameters, ARG_SHAPES.types) : null;
    if (problem) throw new ApiError('invalid_arguments', 400, `${portName}.${method}: ${problem}`, { problem });

    const typed = TYPED_METHODS.has(`${portName}.${method}`);
    // Only a signed-out visitor's call may be answered from the cache: see `visitorCacheSeconds`.
    const cacheSeconds = caller ? undefined : port.visitorCacheSeconds?.[method];
    if (cacheSeconds) {
      const cached = await this.visitorCache.read(portName, method, args);
      if (cached.found) return answer(cached.value, typed);
    }

    const implementation = port.create(this.clients.clientFor(caller)) as Record<string, unknown>;
    const handler = implementation[method];
    if (typeof handler !== 'function') throw new Error(`port ${portName} lists ${method} but its implementation has no such method`);

    try {
      const raw: unknown = await handler.apply(implementation, args);
      // What is cached is what is sent: the result with its dates already marked.
      const result = typed ? markDates(raw).value : raw;
      if (cacheSeconds) await this.visitorCache.write(portName, method, args, result, cacheSeconds);
      return answer(result, typed);
    } catch (error) {
      throw this.toApiError(error) ?? error;
    }
  }

  /** `Object.hasOwn`, so `constructor` or `toString` in the URL can never name a method. */
  private accessOf(port: PortDefinition, method: string): PortAccess | undefined {
    return Object.hasOwn(port.methods, method) ? port.methods[method] : undefined;
  }

  /** A typed port error travels to the app as itself; anything else stays a server fault. */
  private toApiError(error: unknown): ApiError | null {
    const portError = serializePortError(error);
    if (portError) return new ApiError(PORT_ERROR_CODE, 422, portError.message, { port: portError });
    if (error instanceof UnsupportedSupabaseServiceError) return new ApiError('port_method_not_served', 501, error.message);
    return null;
  }
}
