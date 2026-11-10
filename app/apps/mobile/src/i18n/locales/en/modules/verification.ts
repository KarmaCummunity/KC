// FR-VERIFY-001 / FR-VERIFY-013 — verification badges and complete-profile nudges.
export const verificationEn = {
  level: {
    1: 'Complete profile',
    2: 'ID verified',
    3: 'Recognised organization',
  },
  identity: {
    title: 'Identity verification',
    levelNone: 'Not verified',
    doneBody: 'Your identity is verified. You can publish and stay in the housing world.',
    needProfile: 'Complete your profile before identity verification.',
    mockTitle: 'Test verification (development)',
    mockBody: 'One tap raises your level to “ID verified” without a document — development only, until a real provider ships.',
    mockWarning: 'Not for production. Real document + selfie verification will replace this.',
    mockCta: 'Verify for testing',
    providerSoon: 'Document and selfie verification will open here after a provider is chosen (FR-VERIFY-005).',
    settingsRow: 'Identity verification',
    profileNudge: {
      title: 'Complete identity verification',
      body: 'Document and face verification earns the blue badge, builds trust, and is required to publish or host in housing.',
      cta: 'Verify my identity',
    },
  },
  nudge: {
    title: 'Complete your profile details',
    body: 'A complete profile improves your chances of finding matches',
    cta: 'Complete my profile',
    dismiss: 'Close',
    avatarDot: 'Profile not complete',
  },
};
