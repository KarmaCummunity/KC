// FR-FIN-022 / FR-FIN-020 — live public transparency for an organization (the platform org by
// default). Renders nothing while loading, on error, or when the organization has not switched any
// block on: the section appears only as a deliberate publication, never as an empty shell.
import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useOrgTransparency } from '../../hooks/useOrgTransparency';
import { TransparencyView, hasTransparencyContent } from './TransparencyView';

export function OrgTransparencySection({ slug, style }: { slug?: string; style?: StyleProp<ViewStyle> }) {
  const { data } = useOrgTransparency(slug);
  if (!data?.enabled || !hasTransparencyContent(data)) return null;
  return <TransparencyView data={data} style={style} />;
}
