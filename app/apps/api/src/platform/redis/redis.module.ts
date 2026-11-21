import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import type { DependencyProbe } from '../health/dependencyProbe';
import { APP_LOGGER, type AppLogger, appLoggerProvider } from '../logging/appLogger';
import { REDIS_CLIENT } from './redis.tokens';

/** Builds the client. `lazyConnect` defers the connection to the first command. */
function createRedis(config: ApiConfig, logger: AppLogger): Redis {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    // Fail a command after one reconnect attempt instead of queueing it
    // forever: a request must get an error while Redis is down, not hang.
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
  });
  // Connection failures emit `error`; unhandled, they would crash the process.
  redis.on('error', (error) => logger.error({ err: error }, 'redis connection failed'));
  return redis;
}

/** Readiness probe: one `PING` round trip. */
@Injectable()
export class RedisProbe implements DependencyProbe {
  readonly name = 'redis';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async ping(): Promise<void> {
    await this.redis.ping();
  }
}

/** Closes the connection when the process stops. */
@Injectable()
class RedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    // `disconnect` also stops reconnect attempts, which `quit` would wait on
    // when the server is unreachable.
    this.redis.disconnect();
  }
}

@Global()
@Module({
  providers: [
    appLoggerProvider,
    { provide: REDIS_CLIENT, inject: [API_CONFIG, APP_LOGGER], useFactory: createRedis },
    RedisProbe,
    RedisShutdown,
  ],
  exports: [REDIS_CLIENT, RedisProbe],
})
export class RedisModule {}
