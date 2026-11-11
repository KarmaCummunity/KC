// Shows a finance error message with the platform-appropriate dialog (window.alert on web).
import { Alert } from 'react-native';
import { platformSelect } from '@kc/ui';

/** `messages` is the localized `errors` map; unknown codes fall back to its `unknown` entry. */
export function alertError(code: string, messages: Readonly<Record<string, string>> & { unknown: string }): void {
  const msg = messages[code] ?? messages.unknown;
  if (platformSelect({ web: true, default: false })) {
    if (typeof window !== 'undefined') window.alert(msg);
  } else {
    Alert.alert(msg);
  }
}
