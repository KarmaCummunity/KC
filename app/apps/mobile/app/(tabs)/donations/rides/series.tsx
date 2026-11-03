// FR-RIDE-046 — the member's recurring rides: pause, resume, reschedule, cancel.
import React from 'react';
import { MyRideSeriesList } from '../../../../src/components/giving/MyRideSeriesList';

export { RouteErrorBoundary as ErrorBoundary } from '../../../../src/components/RouteErrorBoundary';

export default function RideSeriesScreen() {
  return <MyRideSeriesList />;
}
