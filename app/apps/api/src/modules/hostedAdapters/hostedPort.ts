import type { PortCatalog, PortName } from '@kc/infrastructure-api';
import { definePort, type PortAccess, type PortDefinition } from '../../platform/ports/portDefinition';
import type { SqlBackedClient } from '../../platform/postgrest/sqlBackedClient';

/** Names of the methods of a port interface. */
type MethodName<Port> = { [Key in keyof Port]: Port[Key] extends (...args: never[]) => unknown ? Key : never }[keyof Port] & string;

/**
 * Declares a port of the shared catalog for the gateway. The name must be a
 * catalog name, the implementation must satisfy the interface the catalog
 * gives that name, and every method of it needs an access decision: the app
 * and the API cannot disagree on what a wire name means.
 */
export function hostedPort<Name extends PortName>(
  name: Name,
  spec: {
    create: (client: SqlBackedClient) => PortCatalog[Name];
    methods: Readonly<Record<MethodName<PortCatalog[Name]>, PortAccess>>;
    visitorCacheSeconds?: Readonly<Partial<Record<MethodName<PortCatalog[Name]>, number>>>;
  },
): PortDefinition {
  return definePort<PortCatalog[Name]>({ name, ...spec });
}
