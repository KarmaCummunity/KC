// FR-POST-023 — share texts: what a shared post or profile says in WhatsApp and the other share
// targets. One headline per world × direction × lifecycle, so a ride never reads as an item.
// Worlds: lib/postShareKind.ts (`ShareWorld`). Composer: lib/buildPostShareMessage.ts.

/** A world's headlines: an offer or a request, each while open and once closed. */
const world = (
  offerOpen: string,
  offerClosed: string,
  requestOpen: string,
  requestClosed: string,
) => ({
  offer: { open: offerOpen, closed: offerClosed },
  request: { open: requestOpen, closed: requestClosed },
});

export const shareHe = {
  dialogTitle: 'שיתוף',
  copiedToast: 'הקישור הועתק',
  failedToast: 'השיתוף נכשל, נסו שוב.',
  post: {
    a11y: 'שתפו את הפוסט',
    headline: {
      items: world(
        '🎁 חפץ שמחכה לבית חדש בקהילת קארמה',
        '✅ חפץ שנמסר בהצלחה בקהילת קארמה',
        '🔍 מחפשים חפץ בקהילת קארמה. אולי יש לכם?',
        '✅ בקשה לחפץ שקיבלה מענה בקהילת קארמה',
      ),
      food: world(
        '🍲 אוכל שמחכה למי שצריך, בקהילת קארמה',
        '✅ האוכל נמסר בהצלחה בקהילת קארמה',
        '🥣 מחפשים אוכל בקהילת קארמה. מי יכול לעזור?',
        '✅ בקשת האוכל קיבלה מענה בקהילת קארמה',
      ),
      rides: world(
        '🚗 טרמפ מוצע בקהילת קארמה',
        '✅ הנסיעה הושלמה בקהילת קארמה',
        '🙋 מחפשים טרמפ בקהילת קארמה',
        '✅ בקשת הטרמפ קיבלה מענה בקהילת קארמה',
      ),
      time: world(
        '⏰ מתנדבים להקדיש מזמנם בקהילת קארמה',
        '✅ ההתנדבות התקיימה בקהילת קארמה',
        '🤝 מחפשים מתנדבים בקהילת קארמה',
        '✅ הבקשה להתנדבות קיבלה מענה בקהילת קארמה',
      ),
      housing: world(
        '🏠 מקום לשהות בקהילת קארמה',
        '✅ השהות נקבעה בקהילת קארמה',
        '🛏️ מחפשים מקום לשהות בקהילת קארמה',
        '✅ בקשת המקום קיבלה מענה בקהילת קארמה',
      ),
      animals: world(
        '🐾 הצעה לבעלי חיים בקהילת קארמה',
        '✅ הסיוע לבעל החיים הושלם בקהילת קארמה',
        '🐾 מחפשים עזרה לבעל חיים בקהילת קארמה',
        '✅ הבקשה לעזרה לבעל חיים קיבלה מענה בקהילת קארמה',
      ),
      knowledge: world(
        '📚 מוכנים ללמד ולשתף ידע בקהילת קארמה',
        '✅ השיעור התקיים בקהילת קארמה',
        '🎓 מחפשים מי שילמד אותם בקהילת קארמה',
        '✅ נמצא מורה בקהילת קארמה',
      ),
      challenges: world(
        '🏆 אתגר שמזמין אתכם להצטרף בקהילת קארמה',
        '✅ האתגר הושלם בקהילת קארמה',
        '🏆 מחפשים שותפים לאתגר בקהילת קארמה',
        '✅ האתגר הושלם בקהילת קארמה',
      ),
      generic: world(
        '💚 הצעה מקהילת קארמה',
        '✅ ההצעה מומשה בקהילת קארמה',
        '💚 בקשה לעזרה מקהילת קארמה',
        '✅ הבקשה קיבלה מענה בקהילת קארמה',
      ),
    },
    // The call to action of an open post, per world and direction; a closed post uses ctaClosed.
    cta: {
      items: { offer: 'אולי זה בדיוק בשבילכם. לחצו לפרטים 👇', request: 'אם יש לכם, לחצו לפרטים 👇' },
      food: { offer: 'בתאבון! לפרטים ולתיאום, לחצו כאן 👇', request: 'אם תוכלו לעזור, לחצו לפרטים 👇' },
      rides: { offer: 'אם זה בדרככם, לחצו לפרטים 👇', request: 'אם אתם בדרך, לחצו לפרטים 👇' },
      time: { offer: 'צריכים עזרה? לחצו לפרטים 👇', request: 'רוצים להתנדב? לחצו לפרטים 👇' },
      housing: { offer: 'מחפשים מקום? לחצו לפרטים 👇', request: 'יש לכם מקום להציע? לחצו לפרטים 👇' },
      animals: { offer: 'לפרטים ולתיאום, לחצו כאן 👇', request: 'אם תוכלו לעזור, לחצו לפרטים 👇' },
      knowledge: { offer: 'רוצים ללמוד? לחצו לפרטים 👇', request: 'יכולים ללמד? לחצו לפרטים 👇' },
      challenges: { offer: 'רוצים להצטרף? לחצו לפרטים 👇', request: 'רוצים להצטרף? לחצו לפרטים 👇' },
      generic: { offer: 'לפרטים, לחצו כאן 👇', request: 'אם תוכלו לעזור, לחצו לפרטים 👇' },
    },
    ctaClosed: 'לצפייה בפרטים, לחצו כאן 👇',
    label: {
      publisher: 'מפרסם:',
      counterparty: 'שותף/ה:',
      title: 'כותרת:',
      route: 'מסלול:',
      description: 'תיאור:',
      category: 'קטגוריה:',
      location: 'מיקום:',
      postedAt: 'פורסם:',
      status: 'סטטוס:',
    },
  },
  profile: {
    a11y: 'שתפו את הפרופיל',
    menuItem: 'שיתוף הפרופיל',
    headline: '👋 הפרופיל של {{name}} בקהילת קארמה',
    headlineAnonymous: '👋 פרופיל בקהילת קארמה',
    body: 'קהילה שנותנת ומבקשת מבלי לקנות.',
    cta: 'להכרות, לחצו כאן 👇',
  },
};
