// #2277 (FR-ADMIN-034) — Hebrew strings for the /admin/worlds screen: each giving world as a
// portal or an active world, switched by the super admin.
export const adminWorldsHe = {
  title: 'עולמות נתינה',
  hint: 'עולם פעיל מציג פיד, פוסטים וטופס יצירה. פורטל מציג קישורים וידע בלבד. השינוי חל על הסביבה הזו בלבד.',
  readOnly: 'רק מנהל-על יכול להחליף מצב של עולם.',
  loading: 'טוען...',
  active: 'עולם פעיל',
  portal: 'פורטל',
  makeActive: 'הפעלה',
  makePortal: 'החזרה לפורטל',
  saveError: 'לא הצלחנו לעדכן את העולם. כדאי לנסות שוב.',
  names: {
    items: 'חפצים',
    food: 'אוכל',
    transport: 'טרמפים',
    time: 'זמן',
    money: 'כסף',
    knowledge: 'ידע',
    housing: 'דיור',
    medical: 'רפואה',
    animals: 'בעלי חיים',
    employment: 'תעסוקה',
    democracy: 'דמוקרטיה',
    challenges: 'אתגרים',
  },
} as const;
