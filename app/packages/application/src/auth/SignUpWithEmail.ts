/** FR-AUTH-006: Sign up via email + password. */
import { EMAIL_PATTERN } from '@kc/domain';
import type { IAuthService, AuthSession } from '../ports/IAuthService';
import { AuthError } from './errors';
import { assertPasswordPolicy } from './passwordPolicy';

export interface SignUpWithEmailInput {
  email: string;
  password: string;
  emailRedirectTo?: string;
}

export interface SignUpWithEmailOutput {
  session: AuthSession | null;
  pendingVerification: boolean;
}

export class SignUpWithEmailUseCase {
  constructor(private readonly auth: IAuthService) {}

  async execute(input: SignUpWithEmailInput): Promise<SignUpWithEmailOutput> {
    const email = input.email.trim().toLowerCase();
    const password = input.password;

    this.validate(email, password);

    const session = await this.auth.signUpWithEmail(email, password, {
      emailRedirectTo: input.emailRedirectTo,
    });
    return {
      session,
      pendingVerification: session === null,
    };
  }

  private validate(email: string, password: string): void {
    if (!EMAIL_PATTERN.test(email)) {
      throw new AuthError('invalid_email', 'invalid_email');
    }
    assertPasswordPolicy(password);
  }
}
