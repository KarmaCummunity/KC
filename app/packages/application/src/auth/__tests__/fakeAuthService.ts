import type {
  AppleIdentityCredential,
  AuthProfileMetadataPatch,
  IAuthService,
  AuthSession,
} from '../../ports/IAuthService';
import { AuthError } from '../errors';

export class FakeAuthService implements IAuthService {
  signUpResult: AuthSession | null = null;
  signUpError: Error | null = null;

  signInResult: AuthSession | null = null;
  signInError: Error | null = null;

  currentSession: AuthSession | null = null;
  signOutCalled = 0;

  googleAuthUrl = 'https://example.com/oauth';
  googleAuthUrlError: Error | null = null;
  exchangeResult: AuthSession | null = null;
  exchangeError: Error | null = null;
  lastExchangeCode: string | null = null;

  public resendCalls: Array<{ email: string; emailRedirectTo?: string }> = [];
  public verifyEmailResult: AuthSession | null = null;
  public verifyEmailCalls: string[] = [];
  public lastSignUpRedirect: string | undefined;
  public syncProfileCalls: AuthProfileMetadataPatch[] = [];

  // FR-AUTH-008 password reset.
  public resetRequestCalls: Array<{ email: string; redirectTo?: string }> = [];
  public resetRequestError: Error | null = null;
  public recoveryTokens: string[] = [];
  public recoveryError: Error | null = null;
  public passwordUpdates: string[] = [];
  /** Ordered log of reset-related port calls, to assert sequencing. */
  public resetCallOrder: string[] = [];

  async requestPasswordReset(email: string, options?: { redirectTo?: string }): Promise<void> {
    this.resetRequestCalls.push({ email, redirectTo: options?.redirectTo });
    if (this.resetRequestError) throw this.resetRequestError;
  }

  async verifyPasswordRecovery(tokenHash: string): Promise<AuthSession> {
    this.resetCallOrder.push('verifyPasswordRecovery');
    this.recoveryTokens.push(tokenHash);
    if (this.recoveryError) throw this.recoveryError;
    if (!this.verifyEmailResult) throw new AuthError('unknown', 'no recovery session configured');
    return this.verifyEmailResult;
  }

  async updatePasswordAndSignOutEverywhere(newPassword: string): Promise<void> {
    this.resetCallOrder.push('updatePasswordAndSignOutEverywhere');
    this.passwordUpdates.push(newPassword);
    this.currentSession = null;
  }

  async syncProfileMetadata(patch: AuthProfileMetadataPatch): Promise<void> {
    this.syncProfileCalls.push(patch);
    if (this.currentSession) {
      this.currentSession = {
        ...this.currentSession,
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.avatarUrl !== undefined ? { avatarUrl: patch.avatarUrl } : {}),
      };
    }
  }

  async signUpWithEmail(
    _email: string,
    _password: string,
    options?: { emailRedirectTo?: string },
  ): Promise<AuthSession | null> {
    if (this.signUpError) throw this.signUpError;
    this.lastSignUpRedirect = options?.emailRedirectTo;
    return this.signUpResult;
  }

  signInWithEmail = async (_email: string, _password: string): Promise<AuthSession> => {
    if (this.signInError) throw this.signInError;
    if (!this.signInResult) throw new Error('no signInResult configured');
    return this.signInResult;
  };

  signOut = async (): Promise<void> => {
    this.signOutCalled += 1;
    this.currentSession = null;
  };

  getCurrentSession = async (): Promise<AuthSession | null> => this.currentSession;

  onSessionChange = (_listener: (s: AuthSession | null) => void): (() => void) => () => undefined;

  getGoogleAuthUrl = async (_redirectTo: string): Promise<string> => {
    if (this.googleAuthUrlError) throw this.googleAuthUrlError;
    return this.googleAuthUrl;
  };

  exchangeCodeForSession = async (code: string): Promise<AuthSession> => {
    this.lastExchangeCode = code;
    if (this.exchangeError) throw this.exchangeError;
    if (!this.exchangeResult) throw new Error('no exchangeResult configured');
    return this.exchangeResult;
  };

  appleSignInResult: AuthSession | null = null;
  appleSignInError: Error | null = null;
  lastAppleCredential: AppleIdentityCredential | null = null;

  signInWithApple = async (credential: AppleIdentityCredential): Promise<AuthSession> => {
    this.lastAppleCredential = credential;
    if (this.appleSignInError) throw this.appleSignInError;
    if (!this.appleSignInResult) throw new Error('no appleSignInResult configured');
    return this.appleSignInResult;
  };

  async resendVerificationEmail(
    email: string,
    options?: { emailRedirectTo?: string },
  ): Promise<void> {
    this.resendCalls.push({ email, emailRedirectTo: options?.emailRedirectTo });
  }

  async verifyEmail(tokenHash: string): Promise<AuthSession> {
    this.verifyEmailCalls.push(tokenHash);
    if (!this.verifyEmailResult) {
      throw new AuthError('unknown', 'fake_no_verify_result');
    }
    return this.verifyEmailResult;
  }
}

export function makeSession(overrides: Partial<AuthSession> = {}): AuthSession {
  return {
    userId: 'u_1',
    email: 'a@b.co',
    emailVerified: true,
    accessToken: 'tok',
    refreshToken: 'ref',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    displayName: null,
    avatarUrl: null,
    ...overrides,
  };
}
