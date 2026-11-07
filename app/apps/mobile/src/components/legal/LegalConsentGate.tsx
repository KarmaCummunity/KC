import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View, Pressable, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { usePathname } from 'expo-router';
import type { LegalPendingItem } from '@kc/domain';
import type { CheckPendingLegalAcksResult } from '@kc/application';
import { typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { getCheckPendingLegalAcksUseCase } from '../../services/legalComposition';
import { useModalStackIsEmpty } from './useActiveModalStack';
import { LegalConsentScreen, type LegalConsentMode } from './LegalConsentScreen';
import { LegalUpdateBannerStrip } from './LegalUpdateBannerStrip';
import { legalUpdateDaysRemaining } from './legalConsentRules';
import { layoutWritingDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

const FOREGROUND_DEBOUNCE_MS = 500;

const noop = () => {};

interface LegalConsentGateProps {
  readonly children: ReactNode;
}

type GateState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'clear' }
  | { kind: 'error'; retry: () => void }
  | {
      kind: 'pending';
      result: CheckPendingLegalAcksResult;
      sheetDismissedThisSession: boolean;
      userOptedToAcceptNow: boolean;
    };

export function LegalConsentGate({ children }: LegalConsentGateProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const session = useAuthStore((s) => s.session);
  const userId = session?.userId ?? null;
  const pathname = usePathname();
  const modalStackEmpty = useModalStackIsEmpty();
  const [state, setState] = useState<GateState>({ kind: 'idle' });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onReadingDoc = pathname.startsWith('/legal/');

  const runCheck = useCallback(async () => {
    if (!userId) {
      setState({ kind: 'clear' });
      return;
    }
    setState((prev) => (prev.kind === 'pending' ? prev : { kind: 'loading' }));
    try {
      const result = await getCheckPendingLegalAcksUseCase().execute();
      if (result.pending.length === 0) {
        setState({ kind: 'clear' });
        return;
      }
      setState({
        kind: 'pending',
        result,
        sheetDismissedThisSession: false,
        userOptedToAcceptNow: false,
      });
    } catch (err) {
      console.warn('[legal] consent_check_failed', {
        reason: (err as Error).message,
        timestamp: new Date().toISOString(),
      });
      setState({ kind: 'error', retry: runCheck });
    }
  }, [userId]);

  // Trigger: mount + auth change
  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  // Trigger: AppState 'active' transition (debounced)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(runCheck, FOREGROUND_DEBOUNCE_MS);
    });
    return () => {
      sub.remove();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [runCheck]);

  // Defer rendering when modal is open or user is on /legal/*
  const shouldDefer = !modalStackEmpty || onReadingDoc;

  if (state.kind === 'error') {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
        <Text style={{ ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart }}>
          {t('legal.consentCheckFailed', { defaultValue: t('legal.loadFailed') })}
        </Text>
        <Pressable
          onPress={() => state.retry()}
          style={{
            marginTop: spacing.md,
            padding: spacing.md,
            borderRadius: radius.sm,
            backgroundColor: colors.primary,
            alignItems: 'center',
          }}
        >
          <Text style={{ ...typography.button, color: colors.textInverse }}>{t('general.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.kind !== 'pending' || shouldDefer) {
    return <>{children}</>;
  }

  const mustBlock = state.result.mustBlockImmediately;
  const isSignupShape = state.result.pending.every((p) => p.lastAcceptedVersion === 0);
  const screenMode: LegalConsentMode = isSignupShape ? 'signup' : 'update';

  // Full-screen consent: server says block, or user voluntarily opted to accept now from the sheet
  if (mustBlock || state.userOptedToAcceptNow) {
    return (
      <Modal // brand-guard-allow: full-screen blocking consent screen, not a dialog
        visible
        animationType="slide"
        onRequestClose={noop}
      >
        <LegalConsentScreen
          mode={screenMode}
          pending={state.result.pending}
          onResolved={runCheck}
        />
      </Modal>
    );
  }

  // Banner mode: in-shell affordance + first-foreground sheet
  return (
    <View style={{ flex: 1 }}>
      <LegalUpdateBannerStrip
        pending={state.result.pending}
        onOpen={() => setState({ ...state, userOptedToAcceptNow: true })}
      />
      {children}
      {state.sheetDismissedThisSession ? null : (
        <FirstForegroundSheet
          pending={state.result.pending}
          onSnooze={() => setState({ ...state, sheetDismissedThisSession: true })}
          onAcceptNow={() =>
            setState({
              ...state,
              sheetDismissedThisSession: true,
              userOptedToAcceptNow: true,
            })
          }
        />
      )}
    </View>
  );
}

interface FirstForegroundSheetProps {
  readonly pending: readonly LegalPendingItem[];
  readonly onSnooze: () => void;
  readonly onAcceptNow: () => void;
}

function FirstForegroundSheet({ pending, onSnooze, onAcceptNow }: FirstForegroundSheetProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Web: center the sheet at the bottom with a max width so it doesn't span
  // a 1600px desktop. Native: full-width. Bottom inset added as padding so the
  // sheet content clears the iOS home indicator without SafeAreaView (Modal
  // doesn't always propagate the SafeAreaProvider context cleanly on iOS).
  const sheetStyle =
    Platform.OS === 'web'
      ? ({ width: '100%', maxWidth: 560, alignSelf: 'center' } as const)
      : undefined;
  return (
    <Modal // brand-guard-allow: pre-existing update sheet, kit migration out of scope for #1749
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      transparent
    >
      <View
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}
      >
        <View
          style={[
            {
              backgroundColor: colors.surface,
              borderTopStartRadius: radius.lg,
              borderTopEndRadius: radius.lg,
              paddingBottom: insets.bottom,
            },
            sheetStyle,
          ]}
        >
          <View style={{ padding: spacing.lg }}>
            <Text
              accessibilityRole="header"
              style={{
                ...typography.h4,
                color: colors.textPrimary,
                textAlign: rtlTextAlignStart,
                ...layoutWritingDirectionStyle(),
              }}
            >
              {t('legal.updateBannerHeading')}
            </Text>
            <Text
              style={{
                ...typography.body,
                color: colors.textPrimary,
                textAlign: rtlTextAlignStart,
                ...layoutWritingDirectionStyle(),
                marginTop: spacing.sm,
                lineHeight: 24,
              }}
            >
              {t('legal.updateBannerCountdown', { days: legalUpdateDaysRemaining(pending) })}
            </Text>
            <View style={{ flexDirection: rowDirectionStart, gap: spacing.sm, marginTop: spacing.lg }}>
              {/* Primary action sits at the inline-start edge (right in RTL Hebrew),
                  per iOS HIG: confirmation goes on the reading-start side. */}
              <Pressable
                onPress={onAcceptNow}
                style={{
                  flex: 1,
                  padding: spacing.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...typography.button, color: colors.textInverse }}>
                  {t('legal.updateSheetAccept')}
                </Text>
              </Pressable>
              <Pressable
                onPress={onSnooze}
                style={{
                  flex: 1,
                  padding: spacing.md,
                  borderRadius: radius.sm,
                  backgroundColor: colors.surfaceRaised,
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...typography.button, color: colors.textPrimary }}>
                  {t('legal.updateSheetSnooze')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
