// Moved from supabase/functions/_shared/whatsapp/agent/run.ts as it is.

/** What the agent tells the user after a publish (post_listing's `outcome`), in Hebrew and English. */
export const PUBLISH_OUTCOME_TEXT = {
  published: {
    he: 'הפוסט פורסם ומופיע עכשיו באפליקציה.',
    en: 'Your post is live in the app.',
  },
  draft_photo_required: {
    he: 'הפוסט נשמר כטיוטה וצריך תמונה. שלחו כאן תמונה ואפרסם אותו, או השלימו באפליקציה: {app_link}',
    en: 'Your post was saved as a draft and needs a photo. Send a photo here and I will publish it, or finish in the app: {app_link}',
  },
  draft_staff_review: {
    he: 'הפוסט נשמר כטיוטה וממתין לבדיקה של צוות קארמה, שיפרסם אותו אם הוא מתאים.',
    en: 'Your post was saved as a draft. The KC team will review it and publish it if it fits.',
  },
} as const;
