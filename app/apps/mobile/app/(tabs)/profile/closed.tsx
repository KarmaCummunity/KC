// Legacy URL `/profile/closed`. The closed lane is now a tab on the single My Profile
// screen (#1633), so old links and bookmarks land there with the closed tab selected.
// Mapped to: FR-PROFILE-001 AC4.
import React from 'react';
import { Redirect } from 'expo-router';

export default function MyProfileClosedRedirect() {
  return <Redirect href={{ pathname: '/(tabs)/profile', params: { tab: 'closed' } }} />;
}
