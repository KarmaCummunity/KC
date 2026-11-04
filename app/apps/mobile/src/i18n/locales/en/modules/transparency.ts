// FR-FIN-022 — public financial transparency section (organization page + statistics).
// Strings only; the layout lives in components/finance/*. Category keys mirror
// FINANCE_INCOME_CATEGORIES / FINANCE_EXPENSE_CATEGORIES in @kc/domain.
export const transparencyEn = {
  title: 'Financial transparency',
  subtitle: "This is how the community's finances look. The figures are real and update live. Donor names are never shown.",
  income: 'Income',
  expense: 'Expenses',
  net: 'Balance',
  donationsCount: 'Donations received',
  programRatioTitle: 'Goes directly to our work',
  programRatioBody: '{{percent}}% of expenses go to activities and programs',
  categoriesTitle: 'Where the money goes',
  monthlyTitle: 'Income and expenses, last 12 months',
  monthlyA11y: 'Monthly bar chart of income and expenses',
  updatedAt: 'Last updated: {{date}}',
  category: {
    individual_donations: 'Individual donations',
    corporate_donations: 'Corporate donations',
    standing_orders: 'Standing orders',
    grants: 'Grants',
    other_in: 'Other income',
    program: 'Activities and programs',
    payroll: 'Payroll and benefits',
    rent_ops: 'Rent and operations',
    marketing_fundraising: 'Marketing and fundraising',
    admin_general: 'Administration and general',
    fees: 'Payment and bank fees',
    donor_refunds: 'Donor refunds',
    other_out: 'Other',
  },
};
