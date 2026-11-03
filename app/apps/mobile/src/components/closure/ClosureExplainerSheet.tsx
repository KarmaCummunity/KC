// FR-CLOSURE-004 — one-time educational explainer with "don't show again".
// A centred kit `Modal` despite its name (spec 17 §4.1.1).
import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { useClosureStore } from '../../store/closureStore';
import { useAuthStore } from '../../store/authStore';
import { getUserRepo } from '../../services/userComposition';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { PrimaryButton } from '../ui/Buttons';
import { MIN_TAP_TARGET } from '../ui/kitMetrics';
import { Modal } from '../ui/Modal';

export function ClosureExplainerSheet() {
  const styles = useStyles();
  const { t } = useTranslation();
  const step = useClosureStore((s) => s.step);
  const postType = useClosureStore((s) => s.postType);
  const dismiss = useClosureStore((s) => s.dismissExplainer);
  const completeWithoutExplainer = useClosureStore((s) => s.completeWithoutExplainer);
  const userId = useAuthStore((s) => s.session?.userId);
  const [stayDismissed, setStayDismissed] = useState(false);
  const [alreadyDismissed, setAlreadyDismissed] = useState<boolean | null>(null);

  // Reset local state whenever we leave 'explainer' so the next closure starts fresh.
  useEffect(() => {
    if (step !== 'explainer') {
      setStayDismissed(false);
      setAlreadyDismissed(null);
    }
  }, [step]);

  // Check the persistent flag once when the explainer step is reached.
  useEffect(() => {
    if (step !== 'explainer' || !userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const u = await getUserRepo().findById(userId);
        if (!cancelled) setAlreadyDismissed(u?.closureExplainerDismissed === true);
      } catch {
        if (!cancelled) setAlreadyDismissed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, userId]);

  // Already dismissed forever — fast-forward to step='done' so OwnerActionsBar
  // sees the success signal and notifies the parent. Using `reset()` here would
  // jump straight to 'idle' and skip the parent's onClosed callback. (B3)
  useEffect(() => {
    if (step === 'explainer' && alreadyDismissed === true) {
      completeWithoutExplainer();
    }
  }, [step, alreadyDismissed, completeWithoutExplainer]);

  const visible = step === 'explainer' && alreadyDismissed === false;

  if (!userId) return null;

  // Any dismiss gesture (backdrop, ✕, hardware back, web Escape) is treated as
  // "got it, no persist" — the closure already succeeded, so we still want
  // OwnerActionsBar to fire onClosed (step='done', not 'idle').
  // Direction flips by post.type. The "give" copy is what was originally
  // shipped; the "request" copy mirrors it for the recipient-side flow.
  const give = postType !== 'Request';
  const titleText = give ? t('closure.explainerGiveTitle') : t('closure.explainerRequestTitle');
  const markedBullet = give
    ? t('closure.explainerGiveMarkedBullet')
    : t('closure.explainerRequestMarkedBullet');
  const counterBullet = give
    ? t('closure.explainerGiveCounterBullet')
    : t('closure.explainerRequestCounterBullet');

  return (
    <Modal
      visible={visible}
      title={titleText}
      onDismiss={completeWithoutExplainer}
      footer={
        <PrimaryButton label={t('general.gotIt')} size="md" fullWidth onPress={() => dismiss(stayDismissed, userId)} />
      }
    >
      <View style={styles.list}>
        <Text style={styles.body}>{t('closure.explainerLead')}</Text>
        <Text style={styles.bullet}>{markedBullet}</Text>
        <Text style={styles.bullet}>{t('closure.explainerMiddleBullet')}</Text>
        <Text style={styles.bullet}>{counterBullet}</Text>
      </View>

      <Pressable
        onPress={() => setStayDismissed((v) => !v)}
        style={styles.checkboxRow}
        role="checkbox"
        aria-checked={stayDismissed}
      >
        <View style={[styles.checkbox, stayDismissed && styles.checkboxChecked]}>
          {stayDismissed ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>{t('closure.explainerDontShowAgain')}</Text>
      </Pressable>
    </Modal>
  );
}

/** Side of the "don't show again" box, in points (a layout size). */
const CHECKBOX_SIZE = 22;

const useStyles = makeUseStyles(({ colors }) => ({
  list: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  bullet: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  checkboxRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TAP_TARGET,
  },
  checkbox: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxMark: { ...typography.body, ...typography.bold, color: colors.textInverse },
  checkboxLabel: { ...typography.body, color: colors.textPrimary },
}));
