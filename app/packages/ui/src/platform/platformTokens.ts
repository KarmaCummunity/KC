import type { ViewStyle } from 'react-native';
import { platformSelect } from './platformSelect';

export type PressFeedbackKind = 'opacity' | 'ripple' | 'none';

export interface PlatformRadiusTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export type PlatformShadowPreset = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

export interface PlatformShadowTokens {
  card: PlatformShadowPreset;
  modal: PlatformShadowPreset;
  glow: PlatformShadowPreset;
}

export interface PlatformTokens {
  name: 'ios' | 'android' | 'web';
  pressFeedback: PressFeedbackKind;
  radius: PlatformRadiusTokens;
  shadow: PlatformShadowTokens;
}

export const iosPlatformTokens: PlatformTokens = {
  name: 'ios',
  pressFeedback: 'opacity',
  radius: {
    xs: 4,
    sm: 8,
    md: 10,
    lg: 14,
    xl: 20,
    full: 9999,
  },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 0,
    },
    modal: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.16,
      shadowRadius: 16,
      elevation: 0,
    },
    glow: {
      shadowColor: '#C2410C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 0,
    },
  },
};

export const androidPlatformTokens: PlatformTokens = {
  name: 'android',
  pressFeedback: 'ripple',
  radius: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 28,
    full: 9999,
  },
  shadow: {
    card: {
      elevation: 2,
    },
    modal: {
      elevation: 8,
    },
    glow: {
      elevation: 4,
    },
  },
};

export const webPlatformTokens: PlatformTokens = {
  name: 'web',
  pressFeedback: 'none',
  radius: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    full: 9999,
  },
  shadow: {
    card: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
    },
    modal: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 12,
    },
    glow: {
      shadowColor: '#C2410C',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
    },
  },
};

export function getPlatformTokens(): PlatformTokens {
  return platformSelect<PlatformTokens>({
    ios: iosPlatformTokens,
    android: androidPlatformTokens,
    web: webPlatformTokens,
  });
}
