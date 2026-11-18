// FR-IMPORT-007 AC3 — where an imported post came from, as the card and the detail show it.
import { IMPORT_SOURCE_PLATFORMS, type ImportSourcePlatform } from './importDraft';

const isPlatform = (value: string): value is ImportSourcePlatform =>
  (IMPORT_SOURCE_PLATFORMS as readonly string[]).includes(value);

/**
 * The platform an imported post came from, or null for a post made in KC. An imported post whose
 * platform is missing or not one KC knows reads `unknown` (the chip then says "imported" alone),
 * so a value the app does not understand never hides the fact that the post was imported.
 */
export function importedFromOf(source: string | null | undefined, platform: string | null | undefined): ImportSourcePlatform | null {
  if (source !== 'imported') return null;
  return platform && isPlatform(platform) ? platform : 'unknown';
}
