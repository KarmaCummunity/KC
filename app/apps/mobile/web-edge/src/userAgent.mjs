// Classifies the User-Agent of a request to a shared link. Pure: no I/O, no globals.
//
// The class decides what a shared link answers (see sharedLinkPolicy.mjs):
//   crawler → a link-preview card (WhatsApp, Telegram, Facebook, ...)
//   ios | android → a phone browser, i.e. a person who tapped the link and the OS did not
//                   open the app (it is not installed, or it is not claimed for this host)
//   web → everything else: desktop browsers, unknown clients, in-app browsers

/** Link-preview fetchers. They never render the SPA, so they need the Open Graph card. */
const CRAWLER = /facebookexternalhit|WhatsApp|Twitterbot|TelegramBot|Slackbot|LinkedInBot|SkypeUriPreview|Discordbot|Applebot|googlebot|bingbot|Pinterest|redditbot|Embedly|vkShare/i;

/**
 * Browsers embedded in another app (Facebook, Instagram, Line, ...). Universal links and app
 * links do not fire inside them, so "no app was opened" proves nothing about the install state;
 * sending those users to a store would hide a page they can read right there.
 */
const IN_APP_BROWSER = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|Twitter for/i;

const IOS = /iPhone|iPad|iPod/i;
const ANDROID = /Android/i;

/** @returns {'crawler' | 'ios' | 'android' | 'web'} */
export function classifyUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (CRAWLER.test(ua)) return 'crawler';
  if (IN_APP_BROWSER.test(ua)) return 'web';
  if (IOS.test(ua)) return 'ios';
  if (ANDROID.test(ua)) return 'android';
  return 'web';
}
