import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiConfig } from './apiConfig';

/** Injection token of the validated `ApiConfig`. */
export const API_CONFIG = Symbol('API_CONFIG');

/**
 * Makes the configuration injectable in every module. The value is passed in
 * (not read here) so tests build an app from an explicit config.
 */
@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(config: ApiConfig): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}
