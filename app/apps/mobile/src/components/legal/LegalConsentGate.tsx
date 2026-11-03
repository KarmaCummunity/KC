import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, View, Pressable, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { usePathname } from 'expo-router';
import type { LegalPendingItem } from '@kc/domain';
import type { CheckPendingLegalAcksResult } from '@kc/application';
import { typography, spacing, useTheme, Text } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { getCheckPendingLegalAcksUseCase } from '../../services/legalComposition';
import { useModalStackIsEmpty } from './useActiveModalStack';
import { LegalConsentScreen, type LegalConsentMode } from './LegalConsentScreen';
import { rowDirectionStart } from '../../lib/rtlLayout';
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
      // eslint-disable-next-line no-console
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
            borderRadius: 8,
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
      <Modal visible animationType="slide" onRequestClose={noop}>
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
      <BannerStrip
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
    <Modal visible animationType="slide" presentationStyle="pageSheet" transparent>
      <View
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}
      >
        <View
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
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
                writingDirection: 'rtl',
              }}
            >
              {t('legal.updateBannerHeading')}
            </Text>
            <Text
              style={{
                ...typography.body,
                color: colors.textPrimary,
                textAlign: rtlTextAlignStart,
                writingDirection: 'rtl',
                marginTop: spacing.sm,
                lineHeight: 24,
              }}
            >
              {t('legal.updateBannerCountdown', { days: daysRemaining(pending) })}
            </Text>
            <View style={{ flexDirection: rowDirectionStart, gap: spacing.sm, marginTop: spacing.lg }}>
              {/* Primary action sits at the inline-start edge (right in RTL Hebrew),
                  per iOS HIG: confirmation goes on the reading-start side. */}
              <Pressable
                onPress={onAcceptNow}
                style={{
                  flex: 1,
                  padding: spacing.md,
                  borderRadius: 8,
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
                  borderRadius: 8,
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

function daysRemaining(pending: readonly LegalPendingItem[]): number {
  // Display-only; server is the source of truth for the banner→modal flip.
  if (pending.length === 0) return 7;
  const earliest = Math.min(...pending.map((p) => p.currentEffectiveDate.getTime()));
  const elapsedDays = Math.floor((Date.now() - earliest) / 86_400_000);
  return Math.max(0, 7 - elapsedDays);
}

interface BannerStripProps {
  readonly pending: readonly LegalPendingItem[];
  readonly onOpen: () => void;
}

function BannerStrip({ pending, onOpen }: BannerStripProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onOpen}
      style={{
        backgroundColor: colors.warningLight,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.md,
      }}
    >
      <Text
        style={{
          ...typography.bodySmall,
          color: colors.textPrimary,
          textAlign: rtlTextAlignStart,
          writingDirection: 'rtl',
        }}
      >
        {t('legal.updateBannerHeading')} ·{' '}
        {t('legal.updateBannerCountdown', { days: daysRemaining(pending) })}
      </Text>
    </Pressable>
  );
}
