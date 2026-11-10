import { useMemo, useState } from 'react';
import { View, Pressable, ScrollView, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import type { LegalPendingItem } from '@kc/domain';
import { typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { LegalDocumentReader } from './LegalDocumentReader';
import { LegalConsentCard } from './LegalConsentCard';
import { AgeConfirmationCheckbox } from './AgeConfirmationCheckbox';
import { canSubmitLegalConsent } from './legalConsentRules';
import { getAcceptLegalDocumentUseCase } from '../../services/legalComposition';
import { performFullSignOut } from '../../services/performFullSignOut';
import { useAuthStore } from '../../store/authStore';
import { container } from '../../lib/container';
import { useQueryClient } from '@tanstack/react-query';
import { layoutWritingDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export type LegalConsentMode = 'signup' | 'update';

interface LegalConsentScreenProps {
  readonly mode: LegalConsentMode;
  readonly pending: readonly LegalPendingItem[];
  readonly onResolved: () => void;
}

export function LegalConsentScreen({ mode, pending, onResolved }: LegalConsentScreenProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [readerOpenFor, setReaderOpenFor] = useState<LegalPendingItem | null>(null);

  const allChecked = useMemo(
    () => canSubmitLegalConsent({ mode, pending, accepted, ageConfirmed }),
    [mode, pending, accepted, ageConfirmed],
  );

  const onSubmit = async () => {
    if (submitting || !allChecked) return;
    setSubmitting(true);
    try {
      await Promise.all(
        pending.map((p) =>
          getAcceptLegalDocumentUseCase().execute({
            docType: p.docType,
            version: p.currentVersion,
            locale: 'he',
            userAgent: `${Platform.OS}/${Platform.Version}`,
          }),
        ),
      );
      onResolved();
    } finally {
      setSubmitting(false);
    }
  };

  const onExit = async () => {
    setExitConfirmOpen(false);
    await performFullSignOut({
      deviceRepo: container.deviceRepo,
      queryClient,
      signOutLocal: () => useAuthStore.getState().signOut(),
    });
    router.replace('/');
  };

  // Native Modal renders OUTSIDE the root SafeAreaProvider's measured tree,
  // so wrapping with <SafeAreaView> returns zero insets and the H3 lands
  // under the status bar. Reading insets here via the hook works (the hook
  // resolves against the Provider on Web and the native status-bar metric
  // via the bridge on iOS/Android) — apply them as physical padding.
  const containerStyle =
    Platform.OS === 'web'
      ? ({ maxWidth: 560, alignSelf: 'center', width: '100%' } as const)
      : undefined;

  return (
    <View testID="legal-consent-screen" style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={[
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.lg,
            paddingHorizontal: spacing.lg,
          },
          containerStyle,
        ]}
      >
        <Text
          accessibilityRole="header"
          style={{
            ...typography.h3,
            color: colors.textPrimary,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
            marginBottom: spacing.lg,
            lineHeight: 28,
          }}
        >
          {mode === 'signup' ? t('legal.signupHeading') : t('legal.updateModalHeading')}
        </Text>

        {pending.map((p) => (
          <LegalConsentCard
            key={p.docType}
            item={p}
            checked={!!accepted[p.docType]}
            onToggle={(v) => setAccepted((s) => ({ ...s, [p.docType]: v }))}
            onOpenReader={() => setReaderOpenFor(p)}
          />
        ))}

        {mode === 'signup' ? (
          <AgeConfirmationCheckbox checked={ageConfirmed} onToggle={setAgeConfirmed} />
        ) : null}

        <Pressable
          testID="legal-consent-submit"
          onPress={onSubmit}
          disabled={!allChecked || submitting}
          style={({ pressed }) => ({
            marginTop: spacing.lg,
            paddingVertical: spacing.md,
            borderRadius: radius.md,
            backgroundColor: !allChecked || submitting ? colors.surfaceRaised : colors.primary,
            opacity: pressed ? 0.85 : 1,
            alignItems: 'center',
          })}
        >
          <Text style={{ ...typography.button, color: colors.textInverse }}>
            {mode === 'signup' ? t('legal.signupContinue') : t('legal.updateConfirmCta')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setExitConfirmOpen(true)}
          style={{ marginTop: spacing.md, alignSelf: 'center' }}
        >
          <Text
            style={{
              ...typography.bodySmall,
              color: colors.textSecondary,
              ...layoutWritingDirectionStyle(),
            }}
          >
            {t('legal.exitLink')}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal // brand-guard-allow: pre-existing exit dialog, kit migration out of scope for #1450
        visible={exitConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setExitConfirmOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.overlay,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
        >
          <View
            style={[
              { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg },
              Platform.OS === 'web'
                ? ({ width: '100%', maxWidth: 480, alignSelf: 'center' } as const)
                : null,
            ]}
          >
            <Text
              accessibilityRole="header"
              style={{
                ...typography.h4,
                color: colors.textPrimary,
                textAlign: rtlTextAlignStart,
                ...layoutWritingDirectionStyle(),
              }}
            >
              {t('legal.exitConfirmTitle')}
            </Text>
            <Text
              style={{
                ...typography.body,
                color: colors.textPrimary,
                textAlign: rtlTextAlignStart,
                ...layoutWritingDirectionStyle(),
                marginVertical: spacing.md,
                lineHeight: 24,
              }}
            >
              {t('legal.exitConfirmBody')}
            </Text>
            {/* Destructive action sits at the inline-end (visual left in RTL Hebrew)
                so the safe Cancel button is on the reading-start side. */}
            <View style={{ flexDirection: rowDirectionStart, gap: spacing.sm }}>
              <Pressable
                onPress={() => setExitConfirmOpen(false)}
                style={{
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surfaceRaised,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...typography.button, color: colors.textPrimary }}>
                  {t('legal.exitConfirmCancel')}
                </Text>
              </Pressable>
              <Pressable
                onPress={onExit}
                style={{
                  flex: 1,
                  paddingVertical: spacing.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.error,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...typography.button, color: colors.textInverse }}>
                  {t('legal.exitConfirmConfirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal // brand-guard-allow: full-screen document reader, not a dialog
        visible={!!readerOpenFor}
        animationType="slide"
        onRequestClose={() => setReaderOpenFor(null)}
      >
        {readerOpenFor ? (
          <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
            <Pressable
              onPress={() => setReaderOpenFor(null)}
              style={{ padding: spacing.md, alignSelf: 'flex-start' }}
            >
              <Text style={{ ...typography.button, color: colors.primary }}>
                {t('legal.closeReader')}
              </Text>
            </Pressable>
            <LegalDocumentReader docType={readerOpenFor.docType} />
          </View>
        ) : null}
      </Modal>
    </View>
  );
}

