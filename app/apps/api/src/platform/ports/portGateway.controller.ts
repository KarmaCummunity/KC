import { Body, Controller, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { decodeArgs, MAX_PORT_ARGS, PORT_ERROR_CODE, type PortCallResponse, serializePortError } from '@kc/infrastructure-api';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors/ApiError';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../identity/accessTokenVerifier';
import { resolveCaller } from '../identity/resolveCaller';
import { UnsupportedSupabaseServiceError } from '../postgrest/sqlBackedClient';
import { PortClients } from './portClients';
import type { PortAccess, PortDefinition } from './portDefinition';

/** Injection token of the served ports, by wire name. */
export const PORT_DEFINITIONS = Symbol('PORT_DEFINITIONS');

function readArgs(body: unknown): unknown[] {
  const args = (body as { args?: unknown } | null)?.args;
  if (!Array.isArray(args) || args.length > MAX_PORT_ARGS) {
    throw new ApiError('bad_request', 400, 'a port call body is { "args": [...] }');
  }
  return decodeArgs(args);
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
  ) {}

  @Post(':port/:method')
  @HttpCode(200)
  async call(
    @Param('port') portName: string,
    @Param('method') method: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PortCallResponse> {
    const port = this.ports.get(portName);
    const access = port ? this.accessOf(port, method) : undefined;
    if (!port || !access) throw new ApiError('port_method_not_found', 404, `${portName}.${method}`);
    if (access === 'not_served') throw new ApiError('port_method_not_served', 501, `${portName}.${method}`);

    const caller = await resolveCaller(request, this.verifier);
    if (access === 'member' && !caller) throw new ApiError('unauthorized', 401, 'no bearer token');
    const args = readArgs(body);

    const implementation = port.create(this.clients.clientFor(caller)) as Record<string, unknown>;
    const handler = implementation[method];
    if (typeof handler !== 'function') throw new Error(`port ${portName} lists ${method} but its implementation has no such method`);

    try {
      const result: unknown = await handler.apply(implementation, args);
      return result === undefined ? {} : { result };
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
