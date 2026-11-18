// State and submit flow shared by the email sign-in and sign-up forms — FR-AUTH-006 / FR-AUTH-007.
//
// Holds the typed address and password, the busy flag, the address waiting
// for confirmation, the per-field messages and the error dialog. An empty field
// is reported under that field (FR-RESP-006 AC29) and clears as soon as it is
// typed in. `submit` runs the screen's own use case and says whether the account
// is in, or still waits for its address to be confirmed; any error it throws
// becomes the dialog (auth errors in Hebrew, anything else as a network error).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isAuthError } from '@kc/application';
import { mapAuthErrorToHebrew } from '../../services/authMessages';

export type AuthSubmitOutcome = 'signed-in' | 'pending-verification';

export interface AuthNotice {
  readonly title: string;
  readonly message: string;
}

export interface AuthEmailFormOptions {
  /** Dialog title when `submit` fails. */
  readonly failureTitle: string;
  readonly submit: (email: string, password: string) => Promise<AuthSubmitOutcome>;
}

export function useAuthEmailForm({ failureTitle, submit }: AuthEmailFormOptions) {
  const { t } = useTranslation();
  const [email, setEmailValue] = useState('');
  const [password, setPasswordValue] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  // Typing into a field that showed "required" clears its message.
  const setEmail = (value: string) => {
    setEmailValue(value);
    setEmailError(undefined);
  };
  const setPassword = (value: string) => {
    setPasswordValue(value);
    setPasswordError(undefined);
  };

  const handleSubmit = async () => {
    const missingEmail = !email.trim();
    const missingPassword = !password;
    setEmailError(missingEmail ? t('formField.emailRequired') : undefined);
    setPasswordError(missingPassword ? t('formField.passwordRequired') : undefined);
    if (missingEmail || missingPassword) return;
    setLoading(true);
    try {
      const outcome = await submit(email, password);
      if (outcome === 'pending-verification') setPendingEmail(email.trim().toLowerCase());
    } catch (err) {
      const message = isAuthError(err) ? mapAuthErrorToHebrew(err.code) : t('auth.networkError');
      setNotice({ title: failureTitle, message });
    } finally {
      setLoading(false);
    }
  };

  return {
    email,
    setEmail,
    password,
    setPassword,
    emailError,
    passwordError,
    loading,
    pendingEmail,
    clearPendingEmail: () => setPendingEmail(null),
    notice,
    dismissNotice: () => setNotice(null),
    handleSubmit,
  };
}

export type AuthEmailForm = ReturnType<typeof useAuthEmailForm>;
