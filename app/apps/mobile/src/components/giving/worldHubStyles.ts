import { radius, spacing, typography } from '@kc/ui';

type HubColors = {
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly surfaceRaised: string;
};

/** Shared hero/link/row styles for giving-world hub and list screens. */
export function worldHubBaseStyles(colors: HubColors) {
  return {
    hero: { alignItems: 'center' as const, gap: spacing.md, padding: spacing.lg },
    body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' as const },
    links: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
    },
    link: { ...typography.body, color: colors.primary, ...typography.semiBold },
    row: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceRaised,
    },
    rowTitle: { ...typography.bodyLarge, color: colors.textPrimary },
    rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  };
}
