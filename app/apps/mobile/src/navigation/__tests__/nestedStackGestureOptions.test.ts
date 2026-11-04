import { describe, expect, it, afterEach, vi } from 'vitest';
import { Platform } from 'react-native';
import { getNestedStackGestureOptions } from '../nestedStackGestureOptions';

vi.mock('@kc/ui', () => ({ useTheme: () => ({ colors: { primary: '#000', background: '#fff' } }) }));
vi.mock('../nativeHeaderIconOnly', () => ({ nativeStackHeaderLeftIconOnly: () => ({}) }));
vi.mock('../TopBarStackHeader', () => ({ topBarStackHeader: () => null }));

const setOS = (os: typeof Platform.OS) => {
  (Platform as { OS: typeof Platform.OS }).OS = os;
};

describe('getNestedStackGestureOptions', () => {
  const origPlatform = Platform.OS;
  afterEach(() => setOS(origPlatform));

  it('uses the swipeable slide with a full-screen gesture on ios', () => {
    setOS('ios');
    expect(getNestedStackGestureOptions()).toEqual({
      animation: 'default',
      animationDuration: undefined,
      gestureEnabled: true,
      fullScreenGestureEnabled: true,
    });
  });

  it('keeps the cross-fade on web only', () => {
    setOS('web');
    const opts = getNestedStackGestureOptions();
    expect(opts.animation).toBe('fade');
    expect(opts.animationDuration).toBe(220);
    expect(opts.gestureEnabled).toBe(false);
  });

  it('slides with the edge gesture on android', () => {
    setOS('android');
    const opts = getNestedStackGestureOptions();
    expect(opts.animation).toBe('slide_from_right');
    expect(opts.fullScreenGestureEnabled).toBe(false);
  });

  it('is spread into the world stack options', async () => {
    const { useWorldStackOptions } = await import('../worldStackOptions');
    const { screenOptions } = useWorldStackOptions();
    expect(screenOptions.headerShown).toBe(false);
    expect(screenOptions).toHaveProperty('gestureEnabled');
  });
});
