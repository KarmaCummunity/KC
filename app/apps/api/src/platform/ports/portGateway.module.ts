import { type DynamicModule, Module } from '@nestjs/common';
import { PortClients } from './portClients';
import type { PortDefinition } from './portDefinition';
import { PORT_DEFINITIONS, PortGatewayController } from './portGateway.controller';

/** Two definitions claim the same wire name. */
export class DuplicatePortError extends Error {
  constructor(name: string) {
    super(`port "${name}" is defined twice`);
    this.name = 'DuplicatePortError';
  }
}

/** A visitor cache is declared for a method visitors cannot call, which could only ever leak a member's answer. */
export class VisitorCacheOnPrivateMethodError extends Error {
  constructor(port: string, method: string) {
    super(`${port}.${method} has a visitor cache but is not a public method`);
    this.name = 'VisitorCacheOnPrivateMethodError';
  }
}

/**
 * Indexes the definitions by wire name. A duplicate name, or a visitor cache
 * on a method that is not `public`, is a start-up error, not a silent mistake.
 */
export function indexPorts(definitions: readonly PortDefinition[]): ReadonlyMap<string, PortDefinition> {
  const ports = new Map<string, PortDefinition>();
  for (const definition of definitions) {
    if (ports.has(definition.name)) throw new DuplicatePortError(definition.name);
    for (const method of Object.keys(definition.visitorCacheSeconds ?? {})) {
      if (definition.methods[method] !== 'public') throw new VisitorCacheOnPrivateMethodError(definition.name, method);
    }
    ports.set(definition.name, definition);
  }
  return ports;
}

@Module({})
export class PortGatewayModule {
  /** @param definitions Every port the API serves. Needs the database and identity modules (both global). */
  static forRoot(definitions: readonly PortDefinition[]): DynamicModule {
    return {
      module: PortGatewayModule,
      controllers: [PortGatewayController],
      providers: [PortClients, { provide: PORT_DEFINITIONS, useValue: indexPorts(definitions) }],
    };
  }
}
