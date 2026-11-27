import { randomBytes } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import type { ApiConfig } from '../config/apiConfig';
import { API_CONFIG } from '../config/apiConfig.module';
import { LocalObjectStore } from './localObjectStore';
import { LOCAL_STORE_SECRET, LocalStoreRoutes } from './localStoreRoutes';
import { OBJECT_STORE, type ObjectStore } from './objectStore';
import { StorageController } from './storage.controller';
import { StorageAdmin } from './storageAdmin';
import { StorageAuthorizer } from './storageAuthorizer';
import { StorageCallerFiles } from './storageCallerFiles';
import { StorageService } from './storageService';
import { CALLER_FILES } from '../ports/callerFiles';

/**
 * File storage (ADR-012): the member routes, the authorizer and the object
 * store. Global, so server modules that work on files inject the store. With
 * no store configured the routes answer `503 not_configured` and the rest of
 * the API works. Needs the configuration, database and identity modules.
 */
@Global()
@Module({
  controllers: [StorageController],
  providers: [
    StorageAuthorizer,
    StorageService,
    StorageAdmin,
    LocalStoreRoutes,
    // What a hosted adapter reaches as `client.storage` (the port gateway picks it up when this module is present).
    { provide: CALLER_FILES, useClass: StorageCallerFiles },
    // A key of this process only: a local store's URLs do not outlive a restart.
    { provide: LOCAL_STORE_SECRET, useFactory: () => randomBytes(32).toString('base64url') },
    {
      provide: OBJECT_STORE,
      inject: [API_CONFIG, LOCAL_STORE_SECRET],
      useFactory: (config: ApiConfig, signingSecret: string): ObjectStore | null => {
        const { localDirectory, publicUrl } = config.storage;
        return localDirectory && publicUrl ? new LocalObjectStore({ directory: localDirectory, baseUrl: publicUrl, signingSecret }) : null;
      },
    },
  ],
  exports: [OBJECT_STORE, StorageAuthorizer, StorageService, StorageAdmin, CALLER_FILES],
})
export class StorageModule {}
