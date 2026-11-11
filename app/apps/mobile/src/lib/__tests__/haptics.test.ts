import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

vi.mock('expo-haptics', () => ({
  notificationAsync: vi.fn(),
  impactAsync: vi.fn(),
  performAndroidHapticsAsync: vi.fn(),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
  AndroidHaptics: { Context_Click: 'context_click' },
}));

import { hapticSuccess, hapticLightImpact, hapticLightTap } from '../haptics';

describe('haptics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('on web', () => {
    beforeEach(() => {
      Platform.OS = 'web';
    });

    it('no-ops for hapticSuccess, hapticLightImpact, and hapticLightTap', () => {
      hapticSuccess();
      hapticLightImpact();
      hapticLightTap();

      expect(Haptics.notificationAsync).not.toHaveBeenCalled();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
      expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });
  });

  describe('on iOS', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('triggers success notification for hapticSuccess', () => {
      hapticSuccess();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });

    it('triggers light impact for hapticLightImpact', () => {
      hapticLightImpact();
      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    });

    it('triggers light impact for hapticLightTap', () => {
      hapticLightTap();
      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
      expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    });
  });

  describe('without a haptic engine', () => {
    beforeEach(() => {
      Platform.OS = 'ios';
    });

    it('swallows a rejected feedback call', async () => {
      vi.mocked(Haptics.impactAsync).mockRejectedValueOnce(new Error('no engine'));
      expect(() => hapticLightImpact()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('on Android', () => {
    beforeEach(() => {
      Platform.OS = 'android';
    });

    it('triggers success notification for hapticSuccess', () => {
      hapticSuccess();
      expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
    });

    it('triggers light impact for hapticLightImpact', () => {
      hapticLightImpact();
      expect(Haptics.impactAsync).toHaveBeenCalledWith('light');
    });

    it('triggers performAndroidHapticsAsync with Context_Click for hapticLightTap', () => {
      hapticLightTap();
      expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('context_click');
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    });
  });
});
