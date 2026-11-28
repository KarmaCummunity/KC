// FR-POST-014/022 — post ⋮ menu strings (split from post.ts for LOC cap).
export const postMenuHe = {
  menuA11y: 'תפריט פעולות',
  menuShare: 'לשתף פוסט',
  menuHideFromFeed: 'להסתיר מהפיד שלי',
  menuEdit: 'לערוך פוסט',
  menuSave: 'לשמור',
  menuUnsave: 'להסיר מהשמורים',
  menuDelete: 'למחוק את הפוסט',
  menuAdminRemove: 'להסיר כמנהל',
  saveSuccess: 'הפוסט נשמר.',
  saveError: 'השמירה נכשלה. אפשר לנסות שוב.',
  unsaveSuccess: 'הוסר מהשמורים.',
  unsaveError: 'ההסרה נכשלה. אפשר לנסות שוב.',
  deleteConfirmTitle: '🗑️ למחוק את הפוסט?',
  deleteConfirmBody:
    'הפוסט יוסר מהפוסטים הפעילים. אפשר לפתוח אותו מחדש בחלון השחזור, לפני המחיקה המתוכננת. שיחות קיימות יישארו ברשימת הצ׳אטים שלך.',
  adminRemoveTitle: '🛡️ להסיר את הפוסט?',
  adminRemoveBody:
    'הפוסט "{{title}}" יוסתר מהפיד ויסומן כמוסר על ידי מנהל. ניתן יהיה לשחזר אותו בעתיד דרך יומן האודיט.',
  adminRemoveCta: 'להסיר',
} as const;
