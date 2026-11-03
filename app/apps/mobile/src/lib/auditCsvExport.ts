// app/apps/mobile/src/lib/auditCsvExport.ts
// V2-ADMIN-AUDIT-5 — convert AdminAuditRow[] to CSV + trigger a browser
// download on web. Native is not supported in v1: admins typically run the
// audit screen on desktop; surfacing a clear "web-only" error keeps the
// implementation small. Switch to expo-sharing + FileSystem if mobile use
// shows up.
import { Platform } from 'react-native';
import type { AdminAuditRow } from '@kc/domain';

const CSV_HEADERS = [
  'event_id',
  'created_at',
  'action',
  'actor_id',
  'actor',
  'target_type',
  'target_id',
  'target',
  'metadata',
] as const;

// UTF-8 byte-order mark (\ufeff). Kept as an escape (not a literal) so the
// file doesn't trip `no-irregular-whitespace` in the lint config.
const UTF8_BOM = '\ufeff';

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : JSON.stringify(value);
  // Spreadsheet formula-injection guard. Fields like actor/target display name
  // and metadata are user-controlled; a value starting with = + - @ (or a tab /
  // CR that shifts a value into the next cell) is interpreted as a formula by
  // Excel / Google Sheets. Prefix such values with a single quote so the
  // spreadsheet treats them as text, defusing =HYPERLINK()/=WEBSERVICE()/DDE
  // payloads in an admin's exported audit log. Done BEFORE RFC-4180 quoting.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  // Quote whenever the value contains a delimiter, quote, or newline. Double
  // any embedded quotes per RFC 4180.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: readonly AdminAuditRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(','));
  for (const r of rows) {
    lines.push(
      [
        r.eventId,
        r.createdAt.toISOString(),
        r.action,
        r.actorId ?? '',
        r.actorDisplayName ?? '',
        r.targetType ?? '',
        r.targetId ?? '',
        r.targetDisplayName ?? '',
        r.metadata,
      ]
        .map(escapeCsvField)
        .join(','),
    );
  }
  return `${UTF8_BOM}${lines.join('\r\n')}\r\n`;
}

export function isCsvExportSupported(): boolean {
  return Platform.OS === 'web';
}

export function downloadAuditCsv(rows: readonly AdminAuditRow[], filename: string): boolean {
  if (!isCsvExportSupported()) return false;
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const csv = rowsToCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give Chromium a tick to flush the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 250);
  return true;
}
