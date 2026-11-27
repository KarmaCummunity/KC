import type { Provider, Type } from '@nestjs/common';
import type { HttpAnswer } from '../http/httpAnswer';
import type { CallerIdentity } from '../identity/callerIdentity';

/**
 * What a hosted function may know about the request that reached it. The
 * gateway fills it in; a function never reads a header itself, so the proxy
 * rules (`trustedProxyHops`) are applied once, in one place.
 */
export interface FunctionRequest {
  /** The signed-in member, or null for a visitor. */
  readonly caller: CallerIdentity | null;
  /** The `Origin` header: set by browsers, absent from the native app. */
  readonly origin: string | undefined;
  /** The client's address, as resolved behind the trusted proxies. */
  readonly clientAddress: string;
  /** The `User-Agent` header, or an empty string. */
  readonly userAgent: string;
}

/** A function's answer: the HTTP status and JSON body the Edge Function would have sent. */
export type FunctionAnswer = HttpAnswer;

/**
 * An Edge Function this server has taken over (ADR-009 phase 8). A hosted
 * adapter invokes it by `name` with a JSON body, exactly as it invoked the
 * Edge Function; the implementation is a native module of this server.
 */
export interface HostedFunction {
  /** The Edge Function name the adapters call. Unique across the server. */
  readonly name: string;
  handle(request: FunctionRequest, body: unknown): Promise<FunctionAnswer>;
}

/** Injection token of every `HostedFunction` this server answers. */
export const HOSTED_FUNCTIONS = Symbol('HOSTED_FUNCTIONS');

/**
 * The functions a gateway answers, with the providers they need beyond the
 * platform's own. The gateway module registers both, so a function class may
 * inject anything the gateway can (`PortClients`, the logger, the config).
 */
export interface HostedFunctionSet {
  readonly functions: readonly Type<HostedFunction>[];
  readonly providers: readonly Provider[];
}

/** A gateway that answers no function (tests of the gateway itself). */
export const NO_HOSTED_FUNCTIONS: HostedFunctionSet = { functions: [], providers: [] };
