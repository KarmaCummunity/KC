import websocket, { type WebSocket } from '@fastify/websocket';
import { MAX_REALTIME_FRAME_BYTES, REALTIME_CLOSE, REALTIME_PATH } from '@kc/infrastructure-api';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../identity/accessTokenVerifier';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';
import { EphemeralEvents } from './ephemeralEvents';
import { RealtimeConnection } from './realtimeConnection';
import { RealtimeHub } from './realtimeHub';
import { TopicAuthorizer } from './topicAuthorizer';

/** A connection that sent no valid token within this time is closed. */
export const AUTH_TIMEOUT_MS = 10_000;
/** How often the server pings; a client that answered none since the last ping is gone. */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** The longest a timer is set for; a token that lives longer is checked again then. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

/**
 * The realtime WebSocket endpoint (ADR-011 section 1): `GET /v1/realtime`.
 * It owns only the socket: the timers (token deadline, token expiry,
 * heartbeat) and handing each text frame to the connection. No cookie or
 * header authenticates a connection, only the token frame, so a page of
 * another site that opens a socket has nothing to ride on.
 */
@Injectable()
export class RealtimeGateway implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    @Inject(TopicAuthorizer) private readonly authorizer: TopicAuthorizer,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(EphemeralEvents) private readonly ephemeral: EphemeralEvents,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** Registers the route before the HTTP server is ready; Fastify loads it with its other plugins. */
  onModuleInit(): void {
    const fastify = this.http.httpAdapter.getInstance<FastifyInstance>();
    void fastify.register(async (scope) => {
      await scope.register(websocket, { options: { maxPayload: MAX_REALTIME_FRAME_BYTES } });
      scope.get(REALTIME_PATH, { websocket: true }, (socket) => this.accept(socket));
    });
  }

  private accept(socket: WebSocket): void {
    const connection = new RealtimeConnection(
      { send: (text) => socket.send(text), close: (code) => socket.close(code) },
      { verifier: this.verifier, authorizer: this.authorizer, hub: this.hub, ephemeral: this.ephemeral, report: (error) => this.logger.error({ err: error }, 'realtime request failed') },
    );
    let isAlive = true;
    let expiryTimer: NodeJS.Timeout | null = null;

    /** Closes the connection when its token expires, unless a newer token arrived by then. */
    const watchExpiry = () => {
      if (expiryTimer) clearTimeout(expiryTimer);
      const expiresAt = connection.tokenExpiresAt;
      if (expiresAt === null) return;
      const wait = Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMER_MS);
      expiryTimer = setTimeout(() => (Date.now() >= (connection.tokenExpiresAt ?? 0) ? connection.close(REALTIME_CLOSE.unauthenticated) : watchExpiry()), wait);
      expiryTimer.unref();
    };
    const authTimer = setTimeout(() => {
      if (!connection.isAuthenticated) connection.close(REALTIME_CLOSE.unauthenticated);
    }, AUTH_TIMEOUT_MS);
    const heartbeat = setInterval(() => {
      if (!isAlive) return socket.terminate();
      isAlive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
    authTimer.unref();
    heartbeat.unref();

    socket.on('pong', () => {
      isAlive = true;
    });
    socket.on('message', (data, isBinary) => {
      isAlive = true;
      // The protocol is text; a binary frame is a client that speaks something else.
      if (isBinary) return connection.close(REALTIME_CLOSE.protocol);
      void connection.receive(data.toString()).then(watchExpiry);
    });
    socket.on('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (expiryTimer) clearTimeout(expiryTimer);
      connection.release();
    });
    // An error is followed by `close`; without a listener it would be thrown.
    socket.on('error', () => undefined);
  }
}
