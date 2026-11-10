// FR-FIN-022 — public financial transparency section (organization page + statistics).
// Strings only; the layout lives in components/finance/*. Category keys mirror
// FINANCE_INCOME_CATEGORIES / FINANCE_EXPENSE_CATEGORIES in @kc/domain.
export const transparencyHe = {
  title: 'שקיפות פיננסית',
  subtitle: 'כך נראים הכספים של הקהילה. הנתונים אמיתיים ומתעדכנים בזמן אמת. שמות תורמים לא מוצגים לעולם.',
  income: 'הכנסות',
  expense: 'הוצאות',
  net: 'יתרה',
  donationsCount: 'מספר תרומות',
  programRatioTitle: 'הולך ישירות לפעילות',
  programRatioBody: '{{percent}}% מההוצאות מופנים לפעילות ולתוכניות',
  categoriesTitle: 'לאן הולך הכסף',
  monthlyTitle: 'הכנסות והוצאות ב-12 החודשים האחרונים',
  monthlyA11y: 'גרף עמודות חודשי של הכנסות והוצאות',
  updatedAt: 'עודכן לאחרונה: {{date}}',
  category: {
    individual_donations: 'תרומות מיחידים',
    corporate_donations: 'תרומות מתאגידים',
    standing_orders: 'הוראות קבע',
    grants: 'מענקים',
    other_in: 'הכנסות אחרות',
    program: 'פעילות ותוכניות',
    payroll: 'שכר ונלוות',
    rent_ops: 'שכירות ותפעול',
    marketing_fundraising: 'שיווק וגיוס משאבים',
    admin_general: 'הנהלה וכלליות',
    fees: 'עמלות סליקה ובנק',
    donor_refunds: 'החזרים לתורמים',
    other_out: 'אחר',
  },
};
