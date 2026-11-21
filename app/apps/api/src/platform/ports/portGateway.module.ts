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

/** Indexes the definitions by wire name; a duplicate is a start-up error, not a silent override. */
export function indexPorts(definitions: readonly PortDefinition[]): ReadonlyMap<string, PortDefinition> {
  const ports = new Map<string, PortDefinition>();
  for (const definition of definitions) {
    if (ports.has(definition.name)) throw new DuplicatePortError(definition.name);
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
