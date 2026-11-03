// Tab navigator — kept solely for per-tab state preservation. The visible
// bottom bar is the global <TabBar /> mounted by the root ShellWithTabBar
// (see app/_layout.tsx); we suppress RN's BottomTabBar here so there is one
// — and only one — bar implementation in the app.
// Mapped to: SRS §6.1 — 5 tabs (RTL: Profile | Search | Plus | Donations | Home), per D-16.
import React from 'react';
import { Tabs } from 'expo-router';

export { RouteErrorBoundary as ErrorBoundary } from '../../src/components/RouteErrorBoundary';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={() => null}
    >
      <Tabs.Screen name="profile" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="create" />
      <Tabs.Screen name="donations" />
      <Tabs.Screen name="index" />
    </Tabs>
  );
}
