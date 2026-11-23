import { Module } from '@nestjs/common';
import { DatabaseEvents } from './databaseEvents';
import { EphemeralEvents } from './ephemeralEvents';
import { RealtimeGateway } from './realtimeGateway';
import { RealtimeHub } from './realtimeHub';
import { TopicAuthorizer } from './topicAuthorizer';

/**
 * The realtime gateway (ADR-011): the WebSocket endpoint, the authorizer, the
 * hub and the intake of database events. Needs the configuration, database,
 * identity and port clients modules (all global).
 */
@Module({ providers: [RealtimeHub, EphemeralEvents, TopicAuthorizer, DatabaseEvents, RealtimeGateway], exports: [RealtimeHub] })
export class RealtimeModule {}
