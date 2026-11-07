// FR-CLOSURE-002 + FR-CLOSURE-003 — hybrid Step 1 + Step 2 bottom sheet.
// Step 1 (confirm) and Step 2 (recipient picker) live inside the same modal
// because they're a single transactional flow; Step 3 (the one-time educational
// note) is a separate sheet. Step 2 is now extracted to ClosureStep2.tsx —
// it owns the chats/search mode tabs and is the bigger of the two panes.
//
// The frame, title, dismissal and motion come from the kit `BottomSheet`
// (spec 17 §4.1). Its body does not scroll: Step 2 brings its own bounded lists.
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useClosureStore, type ClosureStep } from '../../store/closureStore';
import { closureCopyKeys } from '../../lib/closureCopy';
import { useAuthStore } from '../../store/authStore';
import { BottomSheet } from '../ui/BottomSheet';
import { GhostButton, PrimaryButton } from '../ui/Buttons';
import { ClosureStep2 } from './ClosureStep2';
import { ClosureErrorPane } from './ClosureErrorPane';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

type Translate = (key: string) => string;

/** Sheet heading for the visible step. The world (or a request) picks the words. */
function closureSheetTitle(
  step: ClosureStep,
  postType: Parameters<typeof closureCopyKeys>[0],
  worldSlug: string | null,
  t: Translate,
): string | undefined {
  const copy = closureCopyKeys(postType, worldSlug);
  if (step === 'confirm') return t(copy.step1Title);
  if (step === 'pick') return t(copy.step2Title);
  if (step === 'error') return t('closure.errorTitle');
  return undefined;
}

export function ClosureSheet() {
  const { t } = useTranslation();
  const step = useClosureStore((s) => s.step);
  const postType = useClosureStore((s) => s.postType);
  const worldSlug = useClosureStore((s) => s.worldSlug);
  const isBusy = useClosureStore((s) => s.isBusy);
  const errorMessage = useClosureStore((s) => s.errorMessage);
  const selectedId = useClosureStore((s) => s.selectedRecipientId);
  const confirmStep1 = useClosureStore((s) => s.confirmStep1);
  const closeWith = useClosureStore((s) => s.closeWith);
  const reset = useClosureStore((s) => s.reset);
  const ownerId = useAuthStore((s) => s.session?.userId);

  // step='error' is shown so the user sees feedback instead of a faded button
  // with nothing happening (the original bug report).
  const visible = step === 'confirm' || step === 'pick' || step === 'error';

  return (
    <BottomSheet
      visible={visible}
      onDismiss={reset}
      title={closureSheetTitle(step, postType, worldSlug, t)}
      scrollable={false}
    >
      {step === 'confirm' && postType ? (
        <Step1 onConfirm={confirmStep1} onCancel={reset} isBusy={isBusy} postType={postType} worldSlug={worldSlug} />
      ) : null}
      {step === 'pick' && ownerId && postType ? (
        <ClosureStep2
          ownerId={ownerId}
          isBusy={isBusy}
          errorMessage={errorMessage}
          onMarkAndClose={() => selectedId && closeWith(selectedId, ownerId)}
          onCloseWithoutMarking={() => closeWith(null, ownerId)}
          onCancel={reset}
        />
      ) : null}
      {step === 'error' ? (
        <ClosureErrorPane errorMessage={errorMessage} onClose={reset} />
      ) : null}
    </BottomSheet>
  );
}

function Step1({
  onConfirm,
  onCancel,
  isBusy,
  postType,
  worldSlug,
}: Readonly<{
  onConfirm: () => void;
  onCancel: () => void;
  isBusy: boolean;
  postType: Parameters<typeof closureCopyKeys>[0];
  worldSlug: string | null;
}>) {
  const styles = useStyles();
  const { t } = useTranslation();
  const copy = closureCopyKeys(postType, worldSlug);
  const body = t(copy.step1Body);
  const cta = t(copy.step1Cta);
  return (
    <View style={styles.pane}>
      <Text style={styles.body}>{body}</Text>
      <PrimaryButton label={cta} size="md" fullWidth loading={isBusy} onPress={onConfirm} />
      <GhostButton label={t('general.cancel')} size="md" fullWidth onPress={onCancel} />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  pane: { gap: spacing.sm },
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginBottom: spacing.sm },
}));
