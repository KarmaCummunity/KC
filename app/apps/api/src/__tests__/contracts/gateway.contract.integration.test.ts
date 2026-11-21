import 'reflect-metadata';
import type { AddressInfo } from 'node:net';
import {
  type ChatContractContext,
  chatRepositoryContract,
  followGraphContract,
  type FollowGraphContractContext,
  type IChatRepository,
  type IPostRepository,
  type IReportRepository,
  type ISavedPostsRepository,
  type IUserRepository,
  postRepositoryContract,
  type PostRepositoryContractContext,
  profileEditingContract,
  type ProfileEditingContractContext,
  type ReportContractContext,
  reportRepositoryContract,
  savedPostsRepositoryContract,
  type SavedPostsContractContext,
} from '@kc/application';
import type { Address } from '@kc/domain';
import { createPortTransport, createRemotePort, type PortTransport } from '@kc/infrastructure-api';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createApp } from '../../createApp';
import { HOSTED_PORTS } from '../../modules/hostedAdapters/hostedPorts';
import { ApiConfigModule } from '../../platform/config/apiConfig.module';
import { DatabaseModule } from '../../platform/database/database.module';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../../platform/identity/accessTokenVerifier';
import { PortGatewayModule } from '../../platform/ports/portGateway.module';
import { RateLimiter } from '../../platform/rateLimit/rateLimiter';
import { KC_DATABASE_URL, KcTestDatabase, type TestMember } from '../support/kcDatabase';
import { testConfig } from '../support/testConfig';
import { createTestIssuer, type TestIssuer } from '../support/testTokens';

/**
 * The shared port contracts through the whole path the app will use:
 * the generic remote port → HTTP → the gateway → the hosted adapters → the
 * compatibility engine → the real KC schema, as the calling member.
 */
describe.skipIf(!KC_DATABASE_URL)('Port contracts through the API gateway', () => {
  const database = new KcTestDatabase();
  const address = {} as Address;
  let app: NestFastifyApplication;
  let issuer: TestIssuer;
  let baseUrl: string;

  beforeAll(async () => {
    issuer = await createTestIssuer();
    const verifier: AccessTokenVerifier = { verify: (token) => issuer.verifier.verify(token) };

    @Global()
    @Module({
      providers: [
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: RateLimiter, useValue: { check: () => Promise.resolve({ allowed: true, retryAfterSeconds: 0 }) } },
      ],
      exports: [ACCESS_TOKEN_VERIFIER, RateLimiter],
    })
    class LocalIdentityModule {}

    const config = testConfig({ databaseUrl: KC_DATABASE_URL ?? '' });
    @Module({ imports: [ApiConfigModule.forRoot(config), DatabaseModule, LocalIdentityModule, PortGatewayModule.forRoot(HOSTED_PORTS)] })
    class GatewayModule {}

    app = await createApp(GatewayModule, config);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    const city = await database.admin.query<{ city_id: string; name_he: string }>('select city_id, name_he from public.cities limit 1');
    const row = city.rows[0];
    if (!row) throw new Error('the reference seed is not loaded: no city');
    Object.assign(address, { city: row.city_id, cityName: row.name_he, street: 'Contract St', streetNumber: '1' });
  });

  afterAll(async () => {
    await app?.close();
    await database.close();
  });

  /** A new member and a transport that calls the API with that member's token. */
  async function newMember(): Promise<{ member: TestMember; transport: PortTransport }> {
    const member = await database.newMember();
    const transport = createPortTransport({ baseUrl, getAccessToken: () => issuer.sign(member.userId) });
    return { member, transport };
  }

  const followGraph: FollowGraphContractContext = {
    newActor: async (privacyMode = 'Public') => {
      const { member, transport } = await newMember();
      if (privacyMode !== 'Public') {
        await database.admin.query('update public.users set privacy_mode = $2 where id = $1', [member.userId, privacyMode]);
      }
      return { userId: member.userId, users: createRemotePort<IUserRepository>(transport, 'user') };
    },
  };
  for (const contractCase of followGraphContract()) {
    it(`follow graph: ${contractCase.name}`, () => contractCase.run(followGraph));
  }

  const profileEditing: ProfileEditingContractContext = {
    cities: [
      { id: '5000', name: 'תל אביב - יפו' },
      { id: '3000', name: 'ירושלים' },
    ],
    newActor: async () => {
      const { member, transport } = await newMember();
      return { userId: member.userId, users: createRemotePort<IUserRepository>(transport, 'user') };
    },
  };
  for (const contractCase of profileEditingContract()) {
    it(`profile editing: ${contractCase.name}`, () => contractCase.run(profileEditing));
  }

  const posts: PostRepositoryContractContext = {
    address,
    reopenCountReadable: false,
    deleteKeepsPostForReopen: true,
    newActor: async () => {
      const { member, transport } = await newMember();
      return { userId: member.userId, repo: createRemotePort<IPostRepository>(transport, 'post') };
    },
  };
  for (const contractCase of postRepositoryContract()) {
    it(`posts: ${contractCase.name}`, () => contractCase.run(posts));
  }

  const savedPosts: SavedPostsContractContext = {
    address,
    deleteKeepsPostForReopen: true,
    newActor: async () => {
      const { member, transport } = await newMember();
      return {
        userId: member.userId,
        posts: createRemotePort<IPostRepository>(transport, 'post'),
        saved: createRemotePort<ISavedPostsRepository>(transport, 'savedPosts'),
      };
    },
  };
  for (const contractCase of savedPostsRepositoryContract()) {
    it(`saved posts: ${contractCase.name}`, () => contractCase.run(savedPosts));
  }

  const chat: ChatContractContext = {
    reopenAfterHide: 'same-thread',
    newActor: async () => {
      const { member, transport } = await newMember();
      return { userId: member.userId, displayName: member.displayName, chats: createRemotePort<IChatRepository>(transport, 'chat') };
    },
  };
  for (const contractCase of chatRepositoryContract()) {
    it(`chat: ${contractCase.name}`, () => contractCase.run(chat));
  }

  const reports: ReportContractContext = {
    newActor: async () => {
      const { member, transport } = await newMember();
      return { userId: member.userId, reports: createRemotePort<IReportRepository>(transport, 'report') };
    },
  };
  for (const contractCase of reportRepositoryContract()) {
    it(`reports: ${contractCase.name}`, () => contractCase.run(reports));
  }
});
