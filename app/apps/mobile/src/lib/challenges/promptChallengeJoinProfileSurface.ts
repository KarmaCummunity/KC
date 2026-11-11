import { Alert, Platform } from 'react-native';

export type ChallengeJoinProfileChoice = 'show' | 'hide' | 'cancel';

type Labels = {
  readonly show: string;
  readonly hide: string;
  readonly cancel: string;
};

/** Ask whether the challenge post should appear on the joiner's public profile open tab. */
export async function promptChallengeJoinProfileSurface(
  title: string,
  message: string,
  labels: Labels,
): Promise<ChallengeJoinProfileChoice> {
  if (Platform.OS === 'web') {
    const w = globalThis.window;
    if (typeof w === 'undefined') return 'cancel';
    const wantJoin = w.confirm(`${title}\n\n${message}\n\n${labels.show} — ${labels.hide}`);
    if (!wantJoin) return 'cancel';
    return w.confirm(`${labels.show}?`) ? 'show' : 'hide';
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: labels.cancel, style: 'cancel', onPress: () => resolve('cancel') },
        { text: labels.hide, onPress: () => resolve('hide') },
        { text: labels.show, onPress: () => resolve('show') },
      ],
      { onDismiss: () => resolve('cancel') },
    );
  });
}
