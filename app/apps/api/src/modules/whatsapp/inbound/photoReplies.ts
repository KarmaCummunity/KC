// What a member is told after sending a photo in WhatsApp (D158), in Hebrew and English. Moved
// from supabase/functions/_shared/whatsapp/photo.ts as it is.
import type { Lang } from './replies';

export type PhotoStatus = 'no_draft' | 'invalid_photo' | 'failed' | 'published' | 'draft_staff_review';

/** What the member is told; `{link}` is the draft's edit link in the app. */
export const PHOTO_REPLY_TEXT: Record<PhotoStatus, Record<Lang, string>> = {
  no_draft: {
    he: 'תודה על התמונה, אבל אין כרגע פוסט שמחכה לתמונה, ולכן לא שמרתי אותה. ספרו לי מה תרצו לתת או לבקש, ואז שלחו תמונה.',
    en: 'Thanks for the photo, but no post of yours is waiting for one, so I did not keep it. Tell me what you want to give or ask for, then send a photo.',
  },
  invalid_photo: {
    he: 'אפשר לצרף רק תמונה (JPEG או PNG) עד 8MB. שלחו תמונה אחרת כאן, או השלימו באפליקציה: {link}',
    en: 'I can only add a photo (JPEG or PNG) of up to 8 MB. Send another photo here, or finish in the app: {link}',
  },
  failed: {
    he: 'לא הצלחתי לצרף את התמונה. נסו לשלוח אותה שוב, או השלימו באפליקציה: {link}',
    en: 'I could not add the photo. Try sending it again, or finish in the app: {link}',
  },
  published: {
    he: 'התמונה נוספה והפוסט פורסם ומופיע עכשיו באפליקציה.',
    en: 'Photo added. Your post is live in the app.',
  },
  draft_staff_review: {
    he: 'התמונה נוספה. הפוסט נשמר כטיוטה וממתין לבדיקה של צוות קארמה, שיפרסם אותו אם הוא מתאים.',
    en: 'Photo added. Your post was saved as a draft; the KC team will review it and publish it if it fits.',
  },
};

export function photoReply(status: PhotoStatus, lang: Lang, link: string): string {
  return PHOTO_REPLY_TEXT[status][lang].replace('{link}', link);
}
