// Screen-level error boundary wrapper (KC#1410).
// Wraps a screen component or route segment. When a descendant throws during render,
// catches the error, reports to Sentry with the screen name, and renders the recoverable
// fallback with a "Try again" button that resets without closing the app.
import React from 'react';
import { ErrorBoundary, type ErrorBoundaryProps } from './ErrorBoundary';

export interface ScreenErrorBoundaryProps extends Omit<ErrorBoundaryProps, 'boundary'> {
  /** Screen or component name reported to Sentry. */
  name?: string;
}

export function ScreenErrorBoundary({ name, tags, ...rest }: ScreenErrorBoundaryProps) {
  return (
    <ErrorBoundary
      boundary="screen"
      tags={{ ...(name ? { screen: name } : {}), ...tags }}
      {...rest}
    />
  );
}
