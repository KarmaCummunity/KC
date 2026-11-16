// #2277 (FR-ADMIN-034) — English strings for the /admin/worlds screen: each giving world as a
// portal or an active world, switched by the super admin.
export const adminWorldsEn = {
  title: 'Giving worlds',
  hint: 'An active world shows a feed, posts and a create form. A portal shows links and knowledge only. The change applies to this environment only.',
  readOnly: 'Only the super admin can switch a world.',
  loading: 'Loading...',
  active: 'Active world',
  portal: 'Portal',
  makeActive: 'Activate',
  makePortal: 'Back to portal',
  saveError: 'We could not update the world. Please try again.',
  names: {
    items: 'Items',
    food: 'Food',
    transport: 'Rides',
    time: 'Time',
    money: 'Money',
    knowledge: 'Knowledge',
    housing: 'Housing',
    medical: 'Medical',
    animals: 'Animals',
    employment: 'Employment',
    democracy: 'Democracy',
    challenges: 'Challenges',
  },
} as const;
