/**
 * Application files that still address the pre-baseline database, by the work package of
 * `docs/db/app-migration-map.md` § 5 that migrates them. One file per package
 * (`P1.ts` … `L7.ts`) so parallel package agents never edit the same lines.
 *
 * Paths are relative to `app/`. A package deletes its files from its own list as it moves
 * them (docs/db/app-migration-playbook.md); `baselineCompatibility.test.ts` fails when a
 * listed file no longer needs the entry, and when an unlisted file needs one.
 */
import { L1_UNMIGRATED } from './L1';
import { L2_UNMIGRATED } from './L2';
import { L3_UNMIGRATED } from './L3';
import { L4_UNMIGRATED } from './L4';
import { L5_UNMIGRATED } from './L5';
import { L6_UNMIGRATED } from './L6';
import { L7_UNMIGRATED } from './L7';
import { P1_UNMIGRATED } from './P1';
import { P2_UNMIGRATED } from './P2';
import { P3_UNMIGRATED } from './P3';
import { P4_UNMIGRATED } from './P4';
import { P5_UNMIGRATED } from './P5';
import { P6_UNMIGRATED } from './P6';

export const PACKAGE_IDS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'] as const;
export type PackageId = (typeof PACKAGE_IDS)[number];

export const MIGRATION_STATUS: Readonly<Record<PackageId, readonly string[]>> = {
  P1: P1_UNMIGRATED,
  P2: P2_UNMIGRATED,
  P3: P3_UNMIGRATED,
  P4: P4_UNMIGRATED,
  P5: P5_UNMIGRATED,
  P6: P6_UNMIGRATED,
  L1: L1_UNMIGRATED,
  L2: L2_UNMIGRATED,
  L3: L3_UNMIGRATED,
  L4: L4_UNMIGRATED,
  L5: L5_UNMIGRATED,
  L6: L6_UNMIGRATED,
  L7: L7_UNMIGRATED,
};
