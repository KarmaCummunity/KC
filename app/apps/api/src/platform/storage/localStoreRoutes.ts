import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { GRANT_PARAMETER, LOCAL_STORE_PATH, LocalObjectStore } from './localObjectStore';
import { OBJECT_STORE, type ObjectStore } from './objectStore';
import { StorageAuthorizer } from './storageAuthorizer';
import { type StorageGrant, verifyGrant } from './storageGrants';

/** Injection token of the key the local store's grants are signed with. */
export const LOCAL_STORE_SECRET = Symbol('LOCAL_STORE_SECRET');
/** The query of a signed address. */
type GrantQuery = Partial<Record<typeof GRANT_PARAMETER, string>>;
/** Largest upload the local store's route reads; a bucket's own limit is lower. */
const MAX_LOCAL_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * The addresses of the local-directory store (ADR-012 section 1): where a
 * granted upload is sent, and where a signed or public file is read from. A
 * cloud store serves these itself; in development and tests the API does, so
 * the app's flow is the same. Registered only when the local store is in use.
 */
@Injectable()
export class LocalStoreRoutes implements OnModuleInit {
  constructor(
    @Inject(HttpAdapterHost) private readonly http: HttpAdapterHost,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore | null,
    @Inject(LOCAL_STORE_SECRET) private readonly secret: string,
    @Inject(StorageAuthorizer) private readonly authorizer: StorageAuthorizer,
  ) {}

  onModuleInit(): void {
    const store = this.store;
    if (!(store instanceof LocalObjectStore)) return;
    const fastify = this.http.httpAdapter.getInstance<FastifyInstance>();
    void fastify.register(async (scope) => {
      // An upload is bytes of whatever type was granted; nothing here is parsed as JSON.
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

      scope.put<{ Querystring: GrantQuery }>(`${LOCAL_STORE_PATH}/upload`, { bodyLimit: MAX_LOCAL_UPLOAD_BYTES }, async (request, reply) => {
        const grant = this.grantOf(request.query[GRANT_PARAMETER], 'upload');
        if (!grant) return reply.status(403).send({ error: 'forbidden' });
        const bytes = request.body;
        if (!Buffer.isBuffer(bytes)) return reply.status(400).send({ error: 'invalid_request' });
        // The grant fixes what may be stored: this type, at most this size.
        if (request.headers['content-type'] !== grant.contentType) return reply.status(415).send({ error: 'type_not_allowed' });
        if (bytes.byteLength > (grant.maxBytes ?? 0)) return reply.status(413).send({ error: 'too_large' });
        const stored = await store.write(grant.bucket, grant.name, bytes, { contentType: grant.contentType ?? 'application/octet-stream', cacheControl: grant.cacheControl ?? null });
        return stored ? reply.status(200).send({ ok: true }) : reply.status(409).send({ error: 'exists' });
      });

      scope.get<{ Querystring: GrantQuery }>(`${LOCAL_STORE_PATH}/read`, async (request, reply) => {
        const grant = this.grantOf(request.query[GRANT_PARAMETER], 'read');
        return grant ? this.serve(store, reply, grant.bucket, grant.name) : reply.status(403).send({ error: 'forbidden' });
      });

      scope.get<{ Params: { bucket: string; '*': string } }>(`${LOCAL_STORE_PATH}/public/:bucket/*`, async (request, reply) => {
        const { bucket, '*': name } = request.params;
        // Only a public bucket has lasting addresses; a private file needs a grant.
        if (!(await this.authorizer.mayRead(null, bucket, name))) return reply.status(404).send({ error: 'not_found' });
        return this.serve(store, reply, bucket, name);
      });
    });
  }

  private grantOf(token: unknown, action: StorageGrant['action']): StorageGrant | null {
    if (typeof token !== 'string') return null;
    const grant = verifyGrant(token, this.secret, Math.floor(Date.now() / 1000));
    return grant?.action === action ? grant : null;
  }

  private async serve(store: ObjectStore, reply: FastifyReply, bucket: string, name: string): Promise<FastifyReply> {
    const [object, bytes] = await Promise.all([store.head(bucket, name), store.read(bucket, name)]);
    if (!object || !bytes) return reply.status(404).send({ error: 'not_found' });
    if (object.cacheControl) void reply.header('cache-control', object.cacheControl);
    // The browser must not guess a type other than the stored one.
    return reply.header('content-type', object.contentType).header('x-content-type-options', 'nosniff').send(Buffer.from(bytes));
  }
}
