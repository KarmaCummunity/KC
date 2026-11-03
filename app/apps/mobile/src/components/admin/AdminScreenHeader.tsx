// app/apps/mobile/src/components/admin/AdminScreenHeader.tsx
// Shared header band for Admin Portal screens (FR-ADMIN-011). Gives every
// inner screen the same title typography, spacing and an optional trailing
// action so the portal reads as one cohesive surface.
//
// Trailing slot resolves in this order:
//   1. `right` — arbitrary node (e.g. a custom button or toggle).
//   2. `newLabel` + `onNew` — renders the default primary "new" button.
import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton } from '../ui/Buttons';
import { rowDirectionStart, textAlignStart } from '../../lib/rtlLayout';

export interface AdminScreenHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly right?: ReactNode;
  readonly newLabel?: string;
  readonly onNew?: () => void;
}

export function AdminScreenHeader({
  title,
  subtitle,
  right,
  newLabel,
  onNew,
}: AdminScreenHeaderProps): ReactElement {
  const styles = useStyles();
  const trailing = right ?? (newLabel && onNew ? (
    <PrimaryButton testID="admin-screen-header-new" label={newLabel} size="sm" onPress={onNew} />
  ) : null);

  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.md,
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md },
  title: {
    flex: 1,
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: textAlignStart(),
  },
  trailing: { flexShrink: 0 },
  subtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: textAlignStart(),
  },
}));
