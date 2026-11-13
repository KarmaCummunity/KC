// #2277 (FR-ADMIN-034) — one row per giving world: its name, whether it is a portal or an active
// world here, and (for the super admin only) the button that switches it. Pure: the route passes
// the rows, the permission and the switch, so the list is tested without the backend.
import React from 'react';
import { View } from 'react-native';
import type { LaunchWorldFlagKey, WorldLaunchMode } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';
import type { WorldLaunchRow } from '../../hooks/useWorldLaunchAdmin';

export interface WorldLaunchSwitchStrings {
  readonly active: string;
  readonly portal: string;
  readonly makeActive: string;
  readonly makePortal: string;
  readonly names: Readonly<Record<string, string>>;
}

export interface WorldLaunchSwitchListProps {
  readonly worlds: readonly WorldLaunchRow[];
  /** False hides every switch: only the super admin may change a world's mode. */
  readonly canSwitch: boolean;
  readonly busyKey: LaunchWorldFlagKey | null;
  readonly onSwitch: (flagKey: LaunchWorldFlagKey, mode: WorldLaunchMode) => void;
  readonly strings: WorldLaunchSwitchStrings;
}

export function WorldLaunchSwitchList({ worlds, canSwitch, busyKey, onSwitch, strings }: WorldLaunchSwitchListProps) {
  const styles = useStyles();
  return (
    <View style={styles.list}>
      {worlds.map((world) => {
        const active = world.mode === 'active';
        // The button offers the other mode: an active world can become a portal and back.
        const Button = active ? SecondaryButton : PrimaryButton;
        return (
          <View key={world.flagKey} style={styles.row} testID={`world-launch-row-${world.tileKey}`}>
            <View style={styles.text}>
              <Text style={styles.name}>{strings.names[world.tileKey] ?? world.tileKey}</Text>
              <Text style={active ? styles.active : styles.portal} testID={`world-launch-mode-${world.tileKey}`}>
                {active ? strings.active : strings.portal}
              </Text>
            </View>
            {canSwitch ? (
              <Button
                testID={`world-launch-switch-${world.tileKey}`}
                label={active ? strings.makePortal : strings.makeActive}
                size="md"
                loading={busyKey === world.flagKey}
                disabled={busyKey !== null && busyKey !== world.flagKey}
                onPress={() => onSwitch(world.flagKey, active ? 'portal' : 'active')}
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
    flexDirection: 'row' as const,
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
  name: { ...typography.h3, color: colors.textPrimary },
  active: { ...typography.caption, color: colors.primary },
  portal: { ...typography.caption, color: colors.textSecondary },
}));
