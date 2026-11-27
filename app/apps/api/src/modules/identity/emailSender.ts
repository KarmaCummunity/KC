/** Injection token of the `EmailSender`, or of null when this server has no email provider. */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

/** An email the identity module asks to be sent. It names what the email is for; its wording belongs to the provider's templates. */
export interface IdentityEmail {
  readonly to: string;
  readonly kind: 'verify_email' | 'reset_password';
  /** The address the member opens; it carries the one-time token. Never logged. */
  readonly link: string;
}

/** Sends the emails of KC's own identity (ADR-013 section 3). No provider is chosen yet (D-231). */
export interface EmailSender {
  send(email: IdentityEmail): Promise<void>;
}
