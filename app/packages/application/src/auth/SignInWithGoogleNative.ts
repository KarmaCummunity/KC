/** FR-AUTH-003+007 (native Google, #1955): the platform account sheet yields an ID token for Supabase. */
import type { IAuthService } from '../ports/IAuthService';
import { AuthError } from './errors';
import type {
  SignInWithGoogleInput,
  SignInWithGoogleOutput,
  SignInWithGoogleUseCase,
} from './SignInWithGoogle';

/**
 * Outcome of the native Google account sheet.
 * - `token`: the user picked an account; `idToken` is audience-bound to the web client.
 * - `cancelled`: the user closed the sheet.
 * - `unavailable`: the SDK can't run here (not configured, no Play services, misconfigured
 *   OAuth client) — the caller should use the browser flow instead.
 */
export type GoogleIdTokenResult =
  | Readonly<{ kind: 'token'; idToken: string }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'unavailable' }>;

export type RequestGoogleIdToken = () => Promise<GoogleIdTokenResult>;

export class SignInWithGoogleNativeUseCase {
  constructor(
    private readonly auth: IAuthService,
    private readonly requestIdToken: RequestGoogleIdToken,
    private readonly browserFlow: SignInWithGoogleUseCase,
  ) {}

  async execute(input: SignInWithGoogleInput): Promise<SignInWithGoogleOutput> {
    const result = await this.requestIdToken();
    if (result.kind === 'cancelled') {
      throw new AuthError('unknown', 'oauth_dismissed');
    }
    if (result.kind === 'unavailable') {
      return this.browserFlow.execute(input);
    }
    const session = await this.auth.signInWithGoogleIdToken(result.idToken);
    return { session };
  }
}
