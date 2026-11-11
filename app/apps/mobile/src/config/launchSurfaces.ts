// First-launch surfaces that stay hidden in a production build until their provider is ready
// (Nave, 2026-11-11): email sign-in/sign-up/reset, the WhatsApp bot, and payments (RevenueCat).
//
// Resolution, first match wins:
//   1. remote row in public.app_flags (`launch_*_enabled`), set by the owner per Supabase project;
//   2. build-time override `EXPO_PUBLIC_LAUNCH_*` ("1"/"true"/"on" or "0"/"false"/"off");
//   3. the environment default: ON in a development build, OFF in production. An unset or unknown
//      EXPO_PUBLIC_ENVIRONMENT is production (see environment.ts), so a misconfigured build hides.
//
// Hidden means unlinked, not removed: the email sign-in route `/sign-in` still works when opened
// directly (deep link `karmacommunity://sign-in`, or the web URL), so the store-review demo account
// can log in. Nothing in the UI links to it while `emailAuth` is off.

import { getAppEnvironment } from './environment';

export const LAUNCH_SURFACES = ['emailAuth', 'whatsappBot', 'payments'] as const;
export type LaunchSurface = (typeof LAUNCH_SURFACES)[number];

/** Keys in public.app_flags that override the build default for a surface. */
export const LAUNCH_SURFACE_REMOTE_KEYS: Record<LaunchSurface, string> = {
  emailAuth: 'launch_email_auth_enabled',
  whatsappBot: 'launch_whatsapp_bot_enabled',
  payments: 'launch_payments_enabled',
};

export type RemoteLaunchFlags = Partial<Record<string, boolean>>;

/** "1"/"true"/"on" → true, "0"/"false"/"off" → false, anything else (including unset) → undefined. */
export function parseLaunchSwitch(raw: string | undefined): boolean | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'on') return true;
  if (value === '0' || value === 'false' || value === 'off') return false;
  return undefined;
}

// Literal property reads: Expo inlines EXPO_PUBLIC_* only for statically named variables.
function buildOverride(surface: LaunchSurface): boolean | undefined {
  switch (surface) {
    case 'emailAuth':
      return parseLaunchSwitch(process.env['EXPO_PUBLIC_LAUNCH_EMAIL_AUTH']);
    case 'whatsappBot':
      return parseLaunchSwitch(process.env['EXPO_PUBLIC_LAUNCH_WHATSAPP_BOT']);
    case 'payments':
      return parseLaunchSwitch(process.env['EXPO_PUBLIC_LAUNCH_PAYMENTS']);
  }
}

/** On in a development build, off in production. */
export function launchSurfaceDefault(): boolean {
  return getAppEnvironment() === 'development';
}

export function resolveLaunchSurface(surface: LaunchSurface, remote?: RemoteLaunchFlags): boolean {
  const remoteValue = remote?.[LAUNCH_SURFACE_REMOTE_KEYS[surface]];
  if (typeof remoteValue === 'boolean') return remoteValue;
  return buildOverride(surface) ?? launchSurfaceDefault();
}
