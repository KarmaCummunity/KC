// Top-level error boundary. Mapped to TD-33 (AUDIT-P2-10).
// Catches unexpected throws from descendant components so the app shell
// renders a recoverable fallback instead of unmounting to a white screen.
// Route segments have their own boundary (RouteErrorBoundary) that shares
// this fallback and report.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { getSentryIfInit } from '../lib/observability/sentry';

export type ErrorBoundaryProps = {
  children: React.ReactNode;
  boundary?: string;
  tags?: Record<string, string>;
  onReset?: () => void;
  fallback?: (props: { error: Error; onRetry: () => void }) => React.ReactNode;
};
type State = { error: Error | null };

/** Report a caught render error to Sentry. Never throws. */
export function reportRenderError(error: Error, context: { tags?: Record<string, string>; componentStack?: string | null }): void {
  if (__DEV__) console.error('ErrorBoundary caught:', error, context.componentStack ?? '');
  try {
    getSentryIfInit()?.captureException(error, {
      tags: context.tags,
      extra: { componentStack: context.componentStack ?? null },
    });
  } catch { /* never crash the boundary */ }
}

export function ErrorBoundaryFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('errorBoundary.title')}</Text>
      <Text style={styles.body}>{t('errorBoundary.body')}</Text>
      {__DEV__ ? <Text style={styles.errMessage}>{error.message}</Text> : null}
      <TouchableOpacity
        testID="error-boundary-retry"
        accessibilityRole="button"
        accessibilityLabel={t('general.retry')}
        style={styles.retryBtn}
        onPress={onRetry}
        activeOpacity={0.8}
      >
        <Text style={styles.retryText}>{t('general.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportRenderError(error, {
      tags: { boundary: this.props.boundary ?? 'root', ...this.props.tags },
      componentStack: info.componentStack,
    });
  }

  reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) {
      return this.props.fallback({ error, onRetry: this.reset });
    }
    return <ErrorBoundaryFallback error={error} onRetry={this.reset} />;
  }
}

const useStyles = makeUseStyles(({ colors }) => ({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.base,
  },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  errMessage: { ...typography.caption, color: colors.textDisabled, textAlign: 'center' },
  retryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  retryText: {
    ...typography.button,
    color: colors.textInverse,
  },
}));
