// Write control wrapper: guests never hit a dead end — hide or prompt sign-up on tap (FR-AUTH-014 AC5).
import React from 'react';
import { Pressable, type AccessibilityRole } from 'react-native';
import { useRouter } from 'expo-router';
import {
  guestWriteVisibility,
  type GuestWritePolicy,
} from '../../navigation/guestWriteGate';

export interface GuestWriteActionProps {
  readonly isAuthenticated: boolean;
  readonly policy?: GuestWritePolicy;
  readonly onAuthenticatedPress: () => void;
  readonly testID?: string;
  readonly accessibilityRole?: AccessibilityRole;
  readonly accessibilityLabel?: string;
  readonly children: React.ReactNode;
}

/** Renders children for members; for guests hides or routes to sign-in on press. */
export function GuestWriteAction({
  isAuthenticated,
  policy = 'prompt',
  onAuthenticatedPress,
  testID,
  accessibilityRole = 'button',
  accessibilityLabel,
  children,
}: GuestWriteActionProps) {
  const router = useRouter();
  const visibility = guestWriteVisibility(isAuthenticated, policy);
  if (visibility === 'hide') return null;

  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        if (visibility === 'prompt') {
          router.push('/(auth)');
          return;
        }
        onAuthenticatedPress();
      }}
    >
      {children}
    </Pressable>
  );
}
