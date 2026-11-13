// FR-ORG-002 (G18) — the organization registration form: name, what it does, contact email,
// optional phone and website, and the non-profit declaration. The domain checks the fields with
// the server's rules first (validateOrgApplication); the KC team reviews the application.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrgErrorCode } from '@kc/domain';
import { OrgError } from '@kc/domain';
import { makeUseStyles, PlatformSwitch, spacing, typography, Text } from '@kc/ui';
import { Card, FormScreen, PrimaryButton, TextField } from '../../../src/components/ui';
import { useShellStackScreenOptions } from '../../../src/navigation/shellStackScreenOptions';
import { orgErrorKey } from '../../../src/lib/organizations/orgErrorMessage';
import { rtlTextAlignStart } from '../../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../../src/lib/webRtlStyle';
import {
  MY_ORG_APPLICATION_QUERY_KEY,
  organizationUseCases,
} from '../../../src/services/organizationsComposition';
export { RouteErrorBoundary as ErrorBoundary } from '../../../src/components/RouteErrorBoundary';

/** Which field each validation code belongs to, so the message shows under it. */
const FIELD_OF: Partial<Record<OrgErrorCode, 'name' | 'description' | 'email' | 'website' | 'nonprofit'>> = {
  org_name_invalid: 'name',
  org_description_required: 'description',
  org_contact_email_invalid: 'email',
  org_website_invalid: 'website',
  org_nonprofit_declaration_required: 'nonprofit',
};

export default function RegisterOrganizationScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = useStyles();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [nonprofit, setNonprofit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; key: string } | null>(null);

  const fieldError = (field: string) => (error?.field === field ? t(error.key) : undefined);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await organizationUseCases.submitApplication().execute({
        orgName: name, orgDescription: description, contactEmail: email,
        contactPhone: phone, websiteUrl: website, declaredNonprofit: nonprofit,
      });
      await queryClient.invalidateQueries({ queryKey: MY_ORG_APPLICATION_QUERY_KEY });
      router.back();
    } catch (err) {
      const code = err instanceof OrgError ? err.code : 'unknown';
      setError({ field: FIELD_OF[code] ?? null, key: orgErrorKey(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ ...shellStackScreenOptions, headerTitle: t('organizations.register.title') }} />
      <FormScreen
        edges={['bottom', 'left', 'right']}
        contentContainerStyle={{ ...styles.body, ...webViewRtl }}
        testID="org-register-screen"
        footer={
          <PrimaryButton
            testID="org-register-submit"
            label={t('organizations.register.submit')}
            onPress={() => void submit()}
            loading={busy}
            fullWidth
            icon="send-outline"
          />
        }
      >
        <Text style={[styles.intro, webTextRtl]}>{t('organizations.register.intro')}</Text>
        <Card padding="base" style={styles.card}>
          <TextField
            testID="org-register-name"
            label={t('organizations.register.nameLabel')}
            value={name}
            onChangeText={setName}
            maxLength={120}
            errorText={fieldError('name')}
            textAlign={rtlTextAlignStart as 'left' | 'right'}
          />
          <TextField
            testID="org-register-description"
            label={t('organizations.register.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={5}
            maxLength={4000}
            errorText={fieldError('description')}
            textAlign={rtlTextAlignStart as 'left' | 'right'}
          />
          <TextField
            testID="org-register-email"
            label={t('organizations.register.emailLabel')}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={320}
            errorText={fieldError('email')}
          />
          <TextField
            label={t('organizations.register.phoneLabel')}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={20}
          />
          <TextField
            label={t('organizations.register.websiteLabel')}
            placeholder={t('organizations.register.websitePlaceholder')}
            value={website}
            onChangeText={setWebsite}
            keyboardType="url"
            autoCapitalize="none"
            maxLength={2000}
            errorText={fieldError('website')}
          />
          <View style={styles.switchRow}>
            <Text style={[styles.switchLabel, webTextRtl]}>{t('organizations.register.nonprofitLabel')}</Text>
            <PlatformSwitch
              testID="org-register-nonprofit"
              accessibilityLabel={t('organizations.register.nonprofitLabel')}
              value={nonprofit}
              onValueChange={setNonprofit}
            />
          </View>
          {error?.field === 'nonprofit' ? <Text style={styles.error}>{t(error.key)}</Text> : null}
        </Card>
        {error?.field === null ? (
          <Text style={[styles.error, webTextRtl]} testID="org-register-error">{t(error.key)}</Text>
        ) : null}
      </FormScreen>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.lg, gap: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary },
  card: { gap: spacing.md },
  switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: spacing.md },
  switchLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
  error: { ...typography.caption, color: colors.error },
}));
