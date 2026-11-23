import { Module } from '@nestjs/common';
import { DatabaseEvents } from './databaseEvents';
import { EphemeralEvents } from './ephemeralEvents';
import { RedisEphemeralEvents } from './redisEphemeralEvents';
import { RealtimeGateway } from './realtimeGateway';
import { RealtimeHub } from './realtimeHub';
import { TopicAuthorizer } from './topicAuthorizer';

/**
 * The realtime gateway (ADR-011): the WebSocket endpoint, the authorizer, the
 * hub, the intake of database events, and Redis for what is not stored.
 * Needs the configuration, database, Redis, identity and port clients modules
 * (all global).
 */
@Module({
  providers: [RealtimeHub, { provide: EphemeralEvents, useClass: RedisEphemeralEvents }, TopicAuthorizer, DatabaseEvents, RealtimeGateway],
  exports: [RealtimeHub],
})
export class RealtimeModule {}
