/**
 * FR-AUTH-008: set a new password from a reset link.
 *
 * The link carries either a `tokenHash` (custom email template, works on any
 * device) or a PKCE `code` (default template, only in the browser that asked
 * for the reset). The password is validated before the single-use token is
 * consumed, so a weak password never burns the link (AC2).
 * After the update every session of the user is revoked and they must sign
 * in again on every device (AC2, AC3).
 */
import type { IAuthService } from '../ports/IAuthService';
import { AuthError } from './errors';
import { assertPasswordPolicy } from './passwordPolicy';

export interface ResetPasswordInput {
  tokenHash?: string;
  code?: string;
  newPassword: string;
}

export class ResetPasswordUseCase {
  constructor(private readonly auth: IAuthService) {}

  async execute(input: ResetPasswordInput): Promise<void> {
    assertPasswordPolicy(input.newPassword);

    if (input.tokenHash) {
      await this.auth.verifyPasswordRecovery(input.tokenHash);
    } else if (input.code) {
      await this.auth.exchangeCodeForSession(input.code);
    } else {
      throw new AuthError('authentication_failed', 'missing_recovery_token');
    }

    await this.auth.updatePasswordAndSignOutEverywhere(input.newPassword);
  }
}
