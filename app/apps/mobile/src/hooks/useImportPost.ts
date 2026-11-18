// Mapped to spec: FR-IMPORT-001 AC1-AC2 (shared or pasted text), FR-IMPORT-007 AC2 (own-post
// attestation, approved as S90): the state of the import screen. A share opens it with the text filled. The member confirms the post is their own
// BEFORE a draft is made, so nothing found in someone else's group reaches the form.
import { useCallback, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { sharedImportText, type SharedImportParams } from '../lib/sharedImportText';
import { extractExternalPostUseCase } from '../services/importComposition';
import { useImportDraftStore } from '../store/importDraftStore';

export function useImportPost() {
  const router = useRouter();
  const params = useLocalSearchParams<Record<keyof SharedImportParams, string | string[]>>();
  // The share sheet's text, read once: the member then edits the field freely.
  const [shared] = useState(() => sharedImportText(params));
  const [text, setText] = useState(shared ?? '');
  const [confirmedOwn, setConfirmedOwn] = useState(false);
  const [busy, setBusy] = useState(false);

  const canSubmit = text.trim() !== '' && confirmedOwn && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      // Never throws: any failure is the manual draft, so the create form always opens.
      // The channel says how the text arrived (the share sheet or a paste); the platform is unknown
      // either way, since a share does not say which app it came from.
      const channel = shared !== null ? 'share' : 'paste';
      const draft = await extractExternalPostUseCase().execute({ text, channel, sourcePlatform: 'unknown' });
      useImportDraftStore.getState().hold(draft, text);
      router.replace('/create?importDraft=1');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, router, shared, text]);

  return { text, setText, confirmedOwn, setConfirmedOwn, busy, canSubmit, submit };
}
