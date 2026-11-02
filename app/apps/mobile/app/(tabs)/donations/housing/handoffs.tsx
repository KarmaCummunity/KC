import React from 'react';
import { MyWorldHandoffsList } from '../../../../src/components/giving/MyWorldHandoffsList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function HousingHandoffsScreen() {
  return <MyWorldHandoffsList worldSlug="housing" />;
}
