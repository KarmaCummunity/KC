// Mapped to spec: FR-POST-001 AC6 / D100, docs/spec/10_challenges.md — the create form of the
// challenges world: "give" is opening a challenge. The creator joins automatically and earns
// karma for opening (07 §7.6, awarded by the database).
import React, { useState, type ReactNode } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { ChallengeDraft } from '@kc/domain';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { ChallengeCreateForm } from '../challenges/ChallengeCreateForm';
import { CHALLENGES_QUERY_KEY, challengeUseCases } from '../../services/challengeComposition';
import { challengeErrorMessage } from '../../lib/challenges/challengeErrorMessage';

interface Props {
  /** Unified create header (category picker; the request / offer toggle is hidden here). */
  readonly header: ReactNode;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

export function ChallengeWorldCreateForm({ header, onPublishActionChange }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = useCreatePostStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submit = async (draft: ChallengeDraft) => {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const challengeId = await challengeUseCases.create().execute(draft);
      await queryClient.invalidateQueries({ queryKey: [CHALLENGES_QUERY_KEY] });
      router.replace({ pathname: '/(tabs)/donations/challenges/[challengeId]', params: { challengeId } });
    } catch (error) {
      setErrorMessage(challengeErrorMessage(t, error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
      keyboardShouldPersistTaps="handled"
      testID="challenge-create-form"
    >
      {header}
      <ChallengeCreateForm
        busy={busy}
        errorMessage={errorMessage}
        onSubmit={(draft) => void submit(draft)}
        onPublishActionChange={onPublishActionChange}
      />
    </ScrollView>
  );
}
