// Recoverable screen for fatal uncaught JS errors (KC#1410).
// The global handler (`installGlobalErrorHandlers`) stores the error instead
// of letting the native side terminate the app; this gate swaps the shell for
// the shared fallback and "retry" remounts the shell from scratch.
import React from 'react';
import { ErrorBoundaryFallback } from './ErrorBoundary';
import { useUncaughtErrorStore } from '../store/uncaughtErrorStore';

export function UncaughtErrorGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const error = useUncaughtErrorStore((s) => s.error);
  const clear = useUncaughtErrorStore((s) => s.clear);
  if (!error) return <>{children}</>;
  return <ErrorBoundaryFallback error={error} onRetry={clear} />;
}
