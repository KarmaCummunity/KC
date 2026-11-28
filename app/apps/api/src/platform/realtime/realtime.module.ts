import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import { REDIS_CLIENT } from '../redis/redis.tokens';
import { DatabaseEvents } from './databaseEvents';
import { EphemeralEvents, InMemoryEphemeralEvents } from './ephemeralEvents';
import { RedisEphemeralEvents } from './redisEphemeralEvents';
import { RealtimeGateway } from './realtimeGateway';
import { RealtimeHub } from './realtimeHub';
import { TopicAuthorizer } from './topicAuthorizer';

/**
 * The realtime gateway (ADR-011): the WebSocket endpoint, the authorizer, the
 * hub, the intake of database events, and Redis for what is not stored (kept
 * in the process itself on a server that runs without Redis).
 * Needs the configuration, database, Redis, identity and port clients modules
 * (all global).
 */
@Module({
  providers: [
    RealtimeHub,
    {
      provide: EphemeralEvents,
      inject: [REDIS_CLIENT, RealtimeHub, APP_LOGGER],
      // Without Redis one process is the whole server, so its own memory is every instance's.
      useFactory: (redis: Redis | null, hub: RealtimeHub, logger: AppLogger): EphemeralEvents =>
        redis === null ? new InMemoryEphemeralEvents(hub) : new RedisEphemeralEvents(redis, hub, logger),
    },
    TopicAuthorizer,
    DatabaseEvents,
    RealtimeGateway,
  ],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
