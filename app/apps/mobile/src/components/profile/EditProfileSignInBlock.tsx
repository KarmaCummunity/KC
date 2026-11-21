// FR-PROFILE-007 AC2: Edit Profile shows the member's sign-in identifiers — the auth email or phone
// and how they sign in — read-only, with a note and a link that send a change request to Support.
// The editable contact phone of AC1 is a separate field of the form, not this one.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { inputTextAlignStart } from '../../lib/rtlLayout';
import { GhostButton } from '../ui/Buttons';
import { TextField } from '../ui/TextField';

export function EditProfileSignInBlock() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const session = useAuthStore((s) => s.session);
  if (!session) return null;

  const provider = session.signInProvider ?? null;
  return (
    <View style={styles.block} testID="edit-profile-sign-in">
      {session.email ? (
        <TextField
          label={t('profile.editScreen.signIn.emailLabel')}
          value={session.email}
          editable={false}
          textAlign={inputTextAlignStart()}
        />
      ) : null}
      {session.phone ? (
        <TextField
          label={t('profile.editScreen.signIn.phoneLabel')}
          value={session.phone}
          editable={false}
          textAlign={inputTextAlignStart()}
        />
      ) : null}
      {provider ? <Text style={styles.method}>{t(`settings.accountIdentity.method.${provider}`)}</Text> : null}
      <Text style={styles.note}>{t('profile.editScreen.signIn.note')}</Text>
      <GhostButton
        label={t('settings.contactChange.cta')}
        size="sm"
        onPress={() => router.push({ pathname: '/settings/report-issue', params: { category: 'Account' } })}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  block: { gap: spacing.xs, marginBottom: spacing.md },
  method: { ...typography.body, color: colors.textPrimary },
  note: { ...typography.caption, color: colors.textSecondary },
}));
