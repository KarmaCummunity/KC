// State and submit flow shared by the email sign-in and sign-up forms — FR-AUTH-006 / FR-AUTH-007.
//
// Holds the typed address and password, the busy flag, the address waiting
// for confirmation and the error dialog. `submit` runs the screen's own use
// case and says whether the account is in, or still waits for its address to
// be confirmed; any error it throws becomes the dialog (auth errors in Hebrew,
// anything else as a network error).
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
  /** Dialog message when the address or the password is empty. */
  readonly missingFieldsMessage: string;
  /** Dialog title when `submit` fails. */
  readonly failureTitle: string;
  readonly submit: (email: string, password: string) => Promise<AuthSubmitOutcome>;
}

export function useAuthEmailForm({ missingFieldsMessage, failureTitle, submit }: AuthEmailFormOptions) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [notice, setNotice] = useState<AuthNotice | null>(null);

  const handleSubmit = async () => {
    if (!email || !password) {
      setNotice({ title: t('auth.genericErrorTitle'), message: missingFieldsMessage });
      return;
    }
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
    loading,
    pendingEmail,
    clearPendingEmail: () => setPendingEmail(null),
    notice,
    dismissNotice: () => setNotice(null),
    handleSubmit,
  };
}

export type AuthEmailForm = ReturnType<typeof useAuthEmailForm>;
