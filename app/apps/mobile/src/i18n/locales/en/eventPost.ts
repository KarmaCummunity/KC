// English — an organization's event (G1 step 5, D31): the create form's kind and organization
// choice, the event section of the post page, registration and the organizer's roster.
// Field and option labels (starts_at, registration_policy, automatic…) live in
// donations.marketplaceFields.ts; error copy in donations.marketplaceErrors.ts.
export const eventPost = {
  create: {
    kindLabel: 'What are you offering?',
    kindShift: 'Volunteer shift',
    kindEvent: 'Organization event',
    orgLabel: 'Organization',
    orgRequired: 'Pick the organization the event is for',
  },
  section: {
    title: 'Event',
    startsAt: 'Starts: {{time}}',
    endsAt: 'Ends: {{time}}',
    address: 'Address: {{address}}',
    capacity: 'Spots: {{count}}',
    policy: 'Registration: {{policy}}',
  },
  registration: {
    register: 'Register',
    requestToJoin: 'Request to join',
    cancel: 'Cancel registration',
    statusReserved: 'Your request is waiting for the organizer’s approval.',
    statusConfirmed: 'You’re registered.',
    statusWaitlisted: 'You’re on the waitlist. You’ll move up automatically when a place frees.',
    leaveWaitlist: 'Leave the waitlist',
    started: 'Registration is closed: the event has started.',
  },
  roster: {
    title: 'Registrations',
    summary: '{{confirmed}} confirmed · {{waiting}} waiting for approval · {{waitlisted}} on the waitlist',
    empty: 'No one has registered yet.',
    loadError: 'We could not load the registrations. Tap to try again.',
    nameFallback: 'Member',
    approve: 'Approve',
    decline: 'Decline',
    remove: 'Remove',
    attended: 'Attended',
    noshow: 'Didn’t come',
    waitlistTitle: 'Waitlist',
    waitlistPosition: '#{{position}} on the waitlist',
    statusLabel: {
      reserved: 'Waiting for approval',
      confirmed: 'Confirmed',
      waitlisted: 'On the waitlist',
      cancelled: 'Cancelled',
      handed_over: 'Attended',
      no_show: 'Did not come',
    },
  },
} as const;
