// Composition root for identity verification (FR-VERIFY-010 AC1). Singletons, lazy-instantiated.

import { getSupabaseClient, SupabaseIdentityVerificationService } from '@kc/infrastructure-supabase';
import {
  GetIdentityVerificationStatusUseCase,
  StartIdentityVerificationUseCase,
  type IIdentityVerificationService,
} from '@kc/application';
import { pickAuthStorage } from './authSecureStorage';

let _service: IIdentityVerificationService | null = null;
let _start: StartIdentityVerificationUseCase | null = null;
let _status: GetIdentityVerificationStatusUseCase | null = null;

function getService(): IIdentityVerificationService {
  _service ??= new SupabaseIdentityVerificationService(getSupabaseClient({ storage: pickAuthStorage() }));
  return _service;
}

export function getStartIdentityVerificationUseCase(): StartIdentityVerificationUseCase {
  _start ??= new StartIdentityVerificationUseCase(getService());
  return _start;
}

export function getIdentityVerificationStatusUseCase(): GetIdentityVerificationStatusUseCase {
  _status ??= new GetIdentityVerificationStatusUseCase(getService());
  return _status;
}
