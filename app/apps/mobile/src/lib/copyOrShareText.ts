// Copy a short text (e.g. a payee phone number) without a native clipboard module:
// web writes to the browser clipboard; iOS / Android open the system share sheet,
// whose "Copy" action covers the same need. Never throws — returns the outcome.
import { Platform, Share } from 'react-native';

export type CopyOrShareOutcome =
  | { kind: 'copied' }
  | { kind: 'shared' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; reason: string };

type ClipboardNavigator = { clipboard?: { writeText: (text: string) => Promise<void> } };

async function copyOnWeb(text: string): Promise<CopyOrShareOutcome> {
  const nav = (globalThis as { navigator?: ClipboardNavigator }).navigator;
  if (!nav?.clipboard?.writeText) return { kind: 'failed', reason: 'no_clipboard' };
  await nav.clipboard.writeText(text);
  return { kind: 'copied' };
}

async function shareOnNative(text: string): Promise<CopyOrShareOutcome> {
  const result = await Share.share({ message: text });
  return result.action === Share.sharedAction ? { kind: 'shared' } : { kind: 'dismissed' };
}

export async function copyOrShareText(text: string): Promise<CopyOrShareOutcome> {
  try {
    return Platform.OS === 'web' ? await copyOnWeb(text) : await shareOnNative(text);
  } catch (err) {
    return { kind: 'failed', reason: err instanceof Error ? err.message : 'unknown' };
  }
}
