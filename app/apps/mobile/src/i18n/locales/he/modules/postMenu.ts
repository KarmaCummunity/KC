// FR-POST-014/022 — post ⋮ menu strings (split from post.ts for LOC cap).
export const postMenuHe = {
  menuA11y: 'תפריט פעולות',
  menuShare: 'שתף פוסט',
  menuHideFromFeed: 'הסתר מהפיד שלי',
  menuEdit: 'ערוך פוסט',
  menuSave: 'שמור',
  menuUnsave: 'הסר מהשמורים',
  menuDelete: 'מחק את הפוסט',
  menuAdminRemove: 'הסר כאדמין',
  saveSuccess: 'הפוסט נשמר.',
  saveError: 'השמירה נכשלה, נסה שוב.',
  unsaveSuccess: 'הוסר מהשמורים.',
  unsaveError: 'ההסרה נכשלה, נסה שוב.',
  deleteConfirmTitle: '🗑️ למחוק את הפוסט?',
  deleteConfirmBody:
    'הפוסט יוסר מהפוסטים הפעילים. אפשר לפתוח אותו מחדש בחלון השחזור, לפני המחיקה המתוכננת. שיחות קיימות יישארו ברשימת הצ׳אטים שלך.',
  adminRemoveTitle: '🛡️ להסיר את הפוסט?',
  adminRemoveBody:
    'הפוסט "{{title}}" יוסתר מהפיד ויסומן כמוסר על ידי מנהל. ניתן יהיה לשחזר אותו בעתיד דרך יומן האודיט.',
  adminRemoveCta: 'הסר',
} as const;
