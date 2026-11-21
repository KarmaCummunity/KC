// Settings → Account identity rows (FR-SETTINGS-002 AC1, AC3; FR-SETTINGS-013).
// Read-only: the display name (edited in Edit Profile, FR-PROFILE-007), the email or phone the
// account is tied to (masked; tapping explains that a change goes through Support), and how the
// member signs in. Google and Apple members learn the provider manages the sign-in, with a link.
import { useState } from 'react';
import { Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { isSsoProvider, maskEmail, maskPhone } from '@kc/domain';
import { Text, typography, makeUseStyles } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { SettingsScreenRow } from '../SettingsScreenRow';
import { ConfirmActionModal } from '../post/ConfirmActionModal';

/** Where a Google or Apple member manages the sign-in KC does not own. */
const PROVIDER_ACCOUNT_URL = {
  google: 'https://myaccount.google.com/',
  apple: 'https://account.apple.com/',
} as const;

interface Props {
  /** The member's display name from their profile; null before onboarding sets one. */
  readonly displayName: string | null;
}

export function AccountIdentityRows({ displayName }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const session = useAuthStore((s) => s.session);
  const [contactDialogVisible, setContactDialogVisible] = useState(false);
  if (!session) return null;

  const provider = session.signInProvider ?? null;
  // The sign-in identity: the email when there is one, else the phone number.
  const contact = session.email
    ? { kind: 'email' as const, masked: maskEmail(session.email) }
    : session.phone
      ? { kind: 'phone' as const, masked: maskPhone(session.phone) }
      : null;
  const caption = (key: string) => <Text style={styles.caption}>{t(key)}</Text>;

  const contactSupport = () => {
    setContactDialogVisible(false);
    router.push({ pathname: '/settings/report-issue', params: { category: 'Account' } });
  };

  return (
    <>
      <SettingsScreenRow
        testID="settings-account-name"
        label={displayName ?? t('settings.accountIdentity.noName')}
        icon="person-circle-outline"
        rightElement={caption('settings.accountIdentity.nameCaption')}
      />
      {contact ? (
        <SettingsScreenRow
          testID="settings-account-contact"
          label={contact.masked}
          icon={contact.kind === 'email' ? 'mail-outline' : 'call-outline'}
          onPress={() => setContactDialogVisible(true)}
          rightElement={caption(`settings.accountIdentity.${contact.kind}Caption`)}
        />
      ) : null}
      {provider ? (
        <SettingsScreenRow
          testID="settings-account-sign-in"
          label={t(`settings.accountIdentity.method.${provider}`)}
          icon="key-outline"
          onPress={
            isSsoProvider(provider)
              ? () => void Linking.openURL(PROVIDER_ACCOUNT_URL[provider]).catch(() => undefined)
              : undefined
          }
          rightElement={isSsoProvider(provider) ? undefined : caption('settings.accountIdentity.methodCaption')}
        />
      ) : null}
      <ConfirmActionModal
        visible={contactDialogVisible}
        title={t('settings.contactChange.title')}
        message={t('settings.contactChange.message')}
        confirmLabel={t('settings.contactChange.cta')}
        onCancel={() => setContactDialogVisible(false)}
        onConfirm={contactSupport}
      />
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  caption: { ...typography.caption, color: colors.textSecondary },
}));
