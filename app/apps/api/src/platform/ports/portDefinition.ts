import type { SqlBackedClient } from '../postgrest/sqlBackedClient';

/**
 * Who may call a port method through the gateway.
 * - `member`: a signed-in caller only.
 * - `public`: anyone; a signed-out visitor runs as the database's `anon` role.
 * - `not_served`: the method exists on the port but the API does not carry it
 *   yet (it needs Storage, an Edge Function or Realtime); the app keeps
 *   calling its current adapter for it.
 */
export type PortAccess = 'member' | 'public' | 'not_served';

/** Names of the methods of a port interface. */
type MethodName<Port> = { [Key in keyof Port]: Port[Key] extends (...args: never[]) => unknown ? Key : never }[keyof Port] & string;

/** One application port as the gateway serves it. */
export interface PortDefinition {
  /** Name on the wire: `POST /v1/ports/<name>/<method>`. */
  readonly name: string;
  /** Builds the implementation for one call, acting as that call's caller. */
  readonly create: (client: SqlBackedClient) => object;
  readonly methods: Readonly<Record<string, PortAccess>>;
  /**
   * Seconds a `public` method's result may be reused for signed-out visitors.
   * Every visitor runs as the same database role, so they all get the same
   * answer; a member's call is never cached, because what a member sees
   * depends on who they are.
   */
  readonly visitorCacheSeconds?: Readonly<Record<string, number | undefined>>;
}

/**
 * Declares a port for the gateway. The compiler requires an access decision
 * for every method of `Port`, so a method added to a port interface cannot
 * reach the API (or be forgotten) without someone deciding who may call it.
 * Nothing that is not a method of the interface can be listed, so an
 * implementation's private helpers are never callable.
 */
export function definePort<Port extends object>(definition: {
  name: string;
  create: (client: SqlBackedClient) => Port;
  methods: Readonly<Record<MethodName<Port>, PortAccess>>;
  visitorCacheSeconds?: Readonly<Partial<Record<MethodName<Port>, number>>>;
}): PortDefinition {
  return definition;
}
