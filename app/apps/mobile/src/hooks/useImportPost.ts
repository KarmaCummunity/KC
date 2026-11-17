// Mapped to spec: FR-IMPORT-001 AC2 (the paste field), FR-IMPORT-007 AC2 (own-post attestation,
// approved as S90): the state of the paste screen. The member confirms the post is their own
// BEFORE a draft is made, so nothing found in someone else's group reaches the form.
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { extractExternalPostUseCase } from '../services/importComposition';
import { useImportDraftStore } from '../store/importDraftStore';

export function useImportPost() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [confirmedOwn, setConfirmedOwn] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = text.trim() !== '' && confirmedOwn && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Never throws: any failure is the manual draft, so the create form always opens.
      const draft = await extractExternalPostUseCase().execute({ text, channel: 'paste', sourcePlatform: 'unknown' });
      useImportDraftStore.getState().hold(draft, text);
      router.replace('/create?importDraft=1');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, router, text]);

  return { text, setText, confirmedOwn, setConfirmedOwn, busy, canSubmit, submit };
}
