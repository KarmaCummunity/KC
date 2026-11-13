// Copy of the link-preview cards. The Workers runtime has no i18next, so this module is the
// edge's locale bundle (D-24 / TD-154; the Hebrew scan skips this directory). Hebrew only: a
// crawler sends no usable language and the site's `og:locale` is he_IL. Keep the world and
// direction keys in step with `WORLDS` in ../src/ogCard.mjs and with the app's share texts.

export const he = {
  appName: 'KC - קהילת קארמה',
  appTagline: 'קהילת קארמה — נותנים ומבקשים מבלי לקנות.',
  profileTitle: 'פרופיל בקהילת קארמה',
  profileDescription: 'הכירו את החברים בקהילה שנותנת ומבקשת מבלי לקנות.',
  closedPrefix: '✅',
  // Card title prefix per world and direction: what kind of post this is, at a glance.
  titlePrefix: {
    items: { offer: '🎁 למסירה', request: '🔍 מבקשים' },
    food: { offer: '🍲 אוכל למסירה', request: '🥣 מבקשים אוכל' },
    rides: { offer: '🚗 טרמפ מוצע', request: '🙋 מחפשים טרמפ' },
    time: { offer: '⏰ התנדבות מוצעת', request: '🤝 מחפשים מתנדבים' },
    housing: { offer: '🏠 מקום לשהות', request: '🛏️ מחפשים מקום' },
    animals: { offer: '🐾 הצעה לבעלי חיים', request: '🐾 עזרה לבעלי חיים' },
    knowledge: { offer: '📚 מוכנים ללמד', request: '🎓 מחפשים מורה' },
    challenges: { offer: '🏆 אתגר', request: '🏆 אתגר' },
    generic: { offer: '💚 הצעה', request: '💚 בקשה' },
  },
  // Description used when the post has none, per world and direction.
  fallbackDescription: {
    items: { offer: 'חפץ שמחכה לבית חדש בקהילת קארמה.', request: 'מישהו בקהילה מחפש חפץ. אולי יש לכם?' },
    food: { offer: 'אוכל שמחכה למי שצריך, בקהילת קארמה.', request: 'מישהו בקהילה מחפש אוכל. מי יכול לעזור?' },
    rides: { offer: 'טרמפ מוצע בקהילת קארמה. לחצו לפרטי הנסיעה.', request: 'מחפשים טרמפ בקהילת קארמה. אם זה בדרככם, לחצו לפרטים.' },
    time: { offer: 'מתנדבים להקדיש מזמנם בקהילת קארמה.', request: 'מחפשים מתנדבים בקהילת קארמה. רוצים להתנדב?' },
    housing: { offer: 'מקום לשהות בקהילת קארמה.', request: 'מחפשים מקום לשהות בקהילת קארמה. יש לכם מקום להציע?' },
    animals: { offer: 'הצעה לבעלי חיים בקהילת קארמה.', request: 'מחפשים עזרה לבעל חיים בקהילת קארמה.' },
    knowledge: { offer: 'מוכנים ללמד ולשתף ידע בקהילת קארמה.', request: 'מחפשים מי שילמד אותם בקהילת קארמה.' },
    challenges: { offer: 'אתגר שמזמין להצטרף בקהילת קארמה.', request: 'אתגר שמזמין להצטרף בקהילת קארמה.' },
    generic: { offer: 'הצעה מקהילת קארמה.', request: 'בקשה לעזרה מקהילת קארמה.' },
  },
};
