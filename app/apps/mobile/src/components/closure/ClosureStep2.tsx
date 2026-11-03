// FR-CLOSURE-003 — recipient picker (Step 2 of the closure sheet).
// Two modes:
//   1. 'chats'  — chat partners loaded by start() (default)
//   2. 'search' — TextInput + debounced search across ALL users
//
// Four user-facing actions (per product brief 2026-05-10):
//   1. Cancel → reset()
//   2. Close without marking → closeWith(null)
//   3. Pick a chat partner → toggle 'chats' mode + select + Mark and Close
//   4. Pick from any user (with search) → toggle 'search' mode + select + Mark and Close
//
// The step title is the heading of the enclosing kit `BottomSheet` (ClosureSheet).
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { useClosureStore } from '../../store/closureStore';
import { GhostButton, PrimaryButton, SecondaryButton } from '../ui/Buttons';
import { ChatsPane, ModeTabs, SearchPane } from './ClosureRecipientPanes';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  readonly ownerId: string;
  readonly isBusy: boolean;
  readonly errorMessage: string | null;
  readonly onMarkAndClose: () => void;
  readonly onCloseWithoutMarking: () => void;
  readonly onCancel: () => void;
}

export function ClosureStep2({
  ownerId,
  isBusy,
  errorMessage,
  onMarkAndClose,
  onCloseWithoutMarking,
  onCancel,
}: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const pickMode = useClosureStore((s) => s.pickMode);
  const candidates = useClosureStore((s) => s.candidates);
  const searchResults = useClosureStore((s) => s.searchResults);
  const searchQuery = useClosureStore((s) => s.searchQuery);
  const isSearching = useClosureStore((s) => s.isSearching);
  const selectedId = useClosureStore((s) => s.selectedRecipientId);
  const setPickMode = useClosureStore((s) => s.setPickMode);
  const setSearchQuery = useClosureStore((s) => s.setSearchQuery);
  const selectRecipient = useClosureStore((s) => s.selectRecipient);

  const showNoResultsHint =
    pickMode === 'search' &&
    searchQuery.length >= 2 &&
    !isSearching &&
    searchResults.length === 0;

  return (
    <View>
      <ModeTabs pickMode={pickMode} chatsCount={candidates.length} onChange={setPickMode} />

      {pickMode === 'chats' ? (
        <ChatsPane candidates={candidates} selectedId={selectedId} onSelect={selectRecipient} />
      ) : (
        <SearchPane
          query={searchQuery}
          onQueryChange={(q) => setSearchQuery(q, ownerId)}
          results={searchResults}
          isSearching={isSearching}
          selectedId={selectedId}
          onSelect={selectRecipient}
        />
      )}

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.actions}>
        <PrimaryButton
          label={t('closure.step2MarkAndClose')}
          size="md"
          fullWidth
          loading={isBusy}
          disabled={!selectedId}
          onPress={onMarkAndClose}
        />
        <SecondaryButton
          label={t('closure.step2CloseWithoutMarking')}
          size="md"
          fullWidth
          disabled={isBusy}
          onPress={onCloseWithoutMarking}
        />
        <GhostButton label={t('general.cancel')} size="md" fullWidth disabled={isBusy} onPress={onCancel} />
      </View>
      {showNoResultsHint ? <Text style={styles.helper}>{t('closure.step2NoSearchResults')}</Text> : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  helper: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  error: { ...typography.body, color: colors.error, textAlign: rtlTextAlignStart, marginBottom: spacing.sm },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
}));
