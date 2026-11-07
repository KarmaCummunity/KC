// The only module that imports expo-haptics (spec 17 §4.4.1, #858; enforced by ESLint).
// Outcome haptics fire after the server confirms; never on errors, removals or toggle-off.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** A device without a haptic engine rejects; feedback is best-effort. */
function fire(feedback: () => Promise<void> | undefined): void {
  if (Platform.OS === 'web') return;
  void Promise.resolve(feedback()).catch(() => {});
}

/** Confirmed outcome: publish, handoff, delivered, a new reaction or like. */
export function hapticSuccess(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/** Kit press feedback (`PrimaryButton`, `PressableScale`); opt out with `haptic={false}`. */
export function hapticLightImpact(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** Light affirmation tap on non-outcome controls (filters, toggles, pull-to-refresh). */
export function hapticLightTap(): void {
  fire(() =>
    Platform.OS === 'ios'
      ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      : Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Context_Click),
  );
}
