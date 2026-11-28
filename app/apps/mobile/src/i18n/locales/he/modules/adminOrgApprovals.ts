// V2-ADMIN-ORG-7 — Hebrew strings for the /admin/org-approvals screen.
export const adminOrgApprovalsHe = {
  title:           'אישור ארגונים',
  forbiddenTitle:  'אין לך הרשאה למסך זה.',
  loading:         'טוען...',
  emptyTitle:      'אין בקשות תואמות',
  emptyHint:       'בקשות חדשות יופיעו כאן כשייכנסו.',
  filters: {
    pending:   'ממתינות',
    approved:  'מאושרות',
    rejected:  'נדחות',
    all:       'הכל',
  },
  status: {
    pending:  'ממתינה',
    approved: 'מאושרת',
    rejected: 'נדחתה',
  },
  row: {
    submittedBy:    (name: string) => `הוגש ע"י ${name}`,
    submittedAt:    (when: string) => `הוגש ב-${when}`,
    decidedBy:      (name: string) => `הוחלט ע"י ${name}`,
    decidedAt:      (when: string) => `הוחלט ב-${when}`,
    noteLabel:      'הערה',
  },
  actions: {
    approve:        'אשר',
    reject:         'דחה',
    busy:           '...',
    confirmApprove: 'לאשר את הבקשה? הפעולה תירשם ביומן.',
    confirmReject:  'לדחות את הבקשה? הפעולה תירשם ביומן.',
  },
  totalCount: (n: number) => `סה"כ ${n} בקשות`,
  errors: {
    forbidden:                    'אין לך הרשאה לבצע פעולה זו.',
    application_not_found:        'הבקשה לא נמצאה.',
    application_already_decided:  'הבקשה כבר טופלה.',
    invalid_status:               'סטטוס לא תקין.',
    unknown:                      'אירעה שגיאה. אפשר לנסות שוב.',
  },
};
