// Mapped to spec: FR-IMPORT-001 AC2 + AC4, FR-IMPORT-007 AC2 (own-post attestation, S90).
// "Import from a message": the member pastes a post they wrote elsewhere, confirms it is their own,
// and the create form opens prefilled from the extraction (or with the text, when nothing could be
// extracted). Behind `external_post_import_enabled`; switched off, the screen is the plain form.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, useTheme, Text } from '@kc/ui';
import { Screen } from '../src/components/ui/Screen';
import { FormScreen, PrimaryButton, TextField } from '../src/components/ui';
import { useFeatureFlag } from '../src/hooks/useFeatureFlag';
import { useImportPost } from '../src/hooks/useImportPost';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

const useStyles = makeUseStyles(({ colors }) => ({
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: spacing.base },
  title: { fontSize: 18, fontWeight: '600' as const, color: colors.textPrimary },
  body: { gap: spacing.base, padding: spacing.base },
  hint: { color: colors.textSecondary },
  own: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  ownLabel: { flex: 1, color: colors.textPrimary },
}));

export default function ImportPostScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const enabled = useFeatureFlag('external_post_import_enabled');
  const form = useImportPost();

  // Off: nothing to import into, the member goes to the ordinary form.
  if (!enabled) return <Redirect href="/create" />;

  return (
    <Screen blobs="off" testID="import-post-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('postImport.close')} testID="import-post-close">
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('postImport.screenTitle')}</Text>
        <View style={{ width: iconSize['2xl'] }} />
      </View>
      <FormScreen
        embedded
        edges={['bottom']}
        contentContainerStyle={styles.body}
        footer={
          <PrimaryButton
            testID="import-post-submit"
            label={t('postImport.submit')}
            fullWidth
            loading={form.busy}
            disabled={!form.canSubmit}
            onPress={form.submit}
          />
        }
      >
        <Text style={styles.hint}>{t('postImport.intro')}</Text>
        <TextField
          testID="import-post-text"
          label={t('postImport.textLabel')}
          placeholder={t('postImport.textPlaceholder')}
          value={form.text}
          onChangeText={form.setText}
          multiline
          editable={!form.busy}
        />
        <TouchableOpacity
          testID="import-post-own"
          style={styles.own}
          onPress={() => form.setConfirmedOwn(!form.confirmedOwn)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: form.confirmedOwn }}
        >
          <Ionicons name={form.confirmedOwn ? 'checkbox' : 'square-outline'} size={iconSize.xl} color={form.confirmedOwn ? colors.primary : colors.textSecondary} />
          <Text style={styles.ownLabel}>{t('postImport.ownLabel')}</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>{t('postImport.ownHint')}</Text>
        <Text style={styles.hint}>{t('postImport.privacyNote')}</Text>
      </FormScreen>
    </Screen>
  );
}
