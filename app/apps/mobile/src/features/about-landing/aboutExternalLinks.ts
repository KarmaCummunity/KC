/**
 * Centralized outbound targets for About → Contact (addresses and paths only).
 * User-facing copy for mail `subject` / WhatsApp `text` lives in i18n (`aboutContent.*`).
 */
export const ABOUT_EMAIL_NAVE = 'karmacommunity2.0@gmail.com';

/** Community WhatsApp — replace with a stable `chat.whatsapp.com` invite when issued. */
export const ABOUT_WHATSAPP_GROUP_URL =
  'https://chat.whatsapp.com/Hi2TpFcO5huKVKarvecz00';

/** Base `wa.me` link; append `?text=` with encoded i18n string in the UI layer. */
export const ABOUT_WHATSAPP_PERSONAL_WA_ME_BASE = 'https://wa.me/972528616878';

export const ABOUT_INSTAGRAM_PROFILE_URL = 'https://www.instagram.com/karma_community_/';
export const ABOUT_FACEBOOK_PROFILE_URL = 'https://www.facebook.com/karma.community';
export const ABOUT_TIKTOK_PROFILE_URL = 'https://www.tiktok.com/@karma_community_';

/** Shown in donation note — direct support outside the app (Bit / PayBox). */
export const ABOUT_DONATION_PHONE_DISPLAY = '0528616878';
