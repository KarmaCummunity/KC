// §5.11 (#1476) — one row per organization: its name, whether it may publish job offers, and (for
// platform admins) the button that allows or stops it. The platform organization always may and a
// suspended one never does, so neither has a button. Pure: the route passes the rows, the
// permission and the switch, so the list is tested without the backend.
import React from 'react';
import { View } from 'react-native';
import type { OrgJobPostingRow } from '@kc/application';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { rowDirectionStart, rtlTextAlignStart } from '../../lib/rtlLayout';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';

export interface OrgJobPostingStrings {
  readonly allowed: string;
  readonly notAllowed: string;
  readonly platform: string;
  readonly suspended: string;
  readonly allow: string;
  readonly stop: string;
}

export interface OrgJobPostingListProps {
  readonly organizations: readonly OrgJobPostingRow[];
  /** False hides every switch: only platform admins change it. */
  readonly canSwitch: boolean;
  readonly busyOrgId: string | null;
  readonly onSwitch: (orgId: string, mayPostJobs: boolean) => void;
  readonly strings: OrgJobPostingStrings;
}

/** The status line of a row: the fixed cases first, then the switch's state. */
function statusOf(org: OrgJobPostingRow, strings: OrgJobPostingStrings): { text: string; allowed: boolean } {
  if (org.isPlatform) return { text: strings.platform, allowed: true };
  if (!org.isActive) return { text: strings.suspended, allowed: false };
  return org.mayPostJobs ? { text: strings.allowed, allowed: true } : { text: strings.notAllowed, allowed: false };
}

export function OrgJobPostingList({ organizations, canSwitch, busyOrgId, onSwitch, strings }: OrgJobPostingListProps) {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {organizations.map((org) => {
        const status = statusOf(org, strings);
        const switchable = canSwitch && !org.isPlatform && org.isActive;
        // The button offers the other state: an allowed organization can be stopped and back.
        const Button = org.mayPostJobs ? SecondaryButton : PrimaryButton;
        return (
          <View key={org.orgId} style={styles.row} testID={`org-jobs-row-${org.orgId}`}>
            <View style={styles.text}>
              <Text style={styles.name}>{org.name}</Text>
              <Text style={status.allowed ? styles.allowed : styles.muted} testID={`org-jobs-status-${org.orgId}`}>
                {status.text}
              </Text>
            </View>
            {switchable ? (
              <Button
                testID={`org-jobs-switch-${org.orgId}`}
                label={org.mayPostJobs ? strings.stop : strings.allow}
                size="md"
                loading={busyOrgId === org.orgId}
                disabled={busyOrgId !== null && busyOrgId !== org.orgId}
                onPress={() => onSwitch(org.orgId, !org.mayPostJobs)}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  list: { gap: spacing.sm },
  row: {
    // Reading-direction row: the text block sits at the right edge, the switch at the left (RTL).
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: { flex: 1, gap: spacing.xs },
  // Explicit start alignment: natural alignment follows the first strong character, so a Latin
  // name such as "Karma Community" would otherwise sit on the wrong edge of an RTL card.
  name: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  allowed: { ...typography.caption, color: colors.primary, textAlign: rtlTextAlignStart },
  muted: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
