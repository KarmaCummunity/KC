import { Platform } from 'react-native';

export type PlatformTarget = 'ios' | 'android' | 'web';

export interface PlatformSelectOptions<T> {
  ios?: T;
  android?: T;
  web?: T;
  default?: T;
}

/**
 * Returns a platform-specific value for iOS, Android, or Web.
 * This is the canonical way to branch on platform across KC.
 */
export function platformSelect<T>(options: PlatformSelectOptions<T>): T {
  const os = Platform.OS as PlatformTarget;
  if (os === 'ios' && options.ios !== undefined) return options.ios;
  if (os === 'android' && options.android !== undefined) return options.android;
  if (os === 'web' && options.web !== undefined) return options.web;
  if (options.default !== undefined) return options.default;
  throw new Error(`platformSelect: no value provided for platform "${Platform.OS}"`);
}
