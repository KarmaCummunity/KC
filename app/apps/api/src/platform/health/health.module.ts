import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { DEPENDENCY_PROBES, type DependencyProbe } from './dependencyProbe';
import { HealthController } from './health.controller';

@Module({})
export class HealthModule {
  /**
   * @param probes Probe classes to run for readiness. Each must be exported
   *   by a global module (the database and Redis modules export theirs).
   */
  static withProbes(probes: ReadonlyArray<Type<DependencyProbe>>): DynamicModule {
    return {
      module: HealthModule,
      controllers: [HealthController],
      providers: [
        {
          provide: DEPENDENCY_PROBES,
          inject: [...probes],
          useFactory: (...instances: DependencyProbe[]): DependencyProbe[] => instances,
        },
      ],
    };
  }
}
