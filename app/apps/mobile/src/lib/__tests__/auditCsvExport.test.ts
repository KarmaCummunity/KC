import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Platform } from 'react-native';
import type { AdminAuditRow } from '@kc/domain';
import { rowsToCsv, isCsvExportSupported, downloadAuditCsv } from '../auditCsvExport';

const BOM = '\ufeff';

function row(overrides: Partial<AdminAuditRow> = {}): AdminAuditRow {
  return {
    eventId: 'e-1',
    actorId: 'u-actor',
    actorDisplayName: 'Actor',
    action: 'ban_user',
    targetType: 'user',
    targetId: 'u-target',
    targetDisplayName: 'Target',
    metadata: {},
    createdAt: new Date('2026-05-28T01:23:45.000Z'),
    ...overrides,
  };
}

function stripBom(csv: string): string {
  return csv.startsWith(BOM) ? csv.slice(1) : csv;
}

describe('auditCsvExport.rowsToCsv', () => {
  it('emits the canonical header line', () => {
    const csv = rowsToCsv([row()]);
    const firstLine = stripBom(csv).split('\r\n')[0];
    expect(firstLine).toBe(
      'event_id,created_at,action,actor_id,actor,target_type,target_id,target,metadata',
    );
  });

  it('escapes commas, quotes, and newlines per RFC 4180', () => {
    const csv = rowsToCsv([
      row({ actorDisplayName: 'Smith, John', metadata: { note: 'has "quotes"' } }),
      row({ eventId: 'e-2', actorDisplayName: 'Has\nNewline' }),
    ]);
    const lines = stripBom(csv).split('\r\n');
    expect(lines[1]).toContain('"Smith, John"');
    expect(lines[2]).toContain('"Has\nNewline"');
  });

  it('emits a UTF-8 BOM so Excel detects the encoding for Hebrew names', () => {
    const csv = rowsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('serialises metadata via JSON.stringify and double-quotes embedded quotes', () => {
    const csv = rowsToCsv([row({ metadata: { reason: 'spam', count: 3 } })]);
    // RFC 4180: a field containing a comma must be quoted, and embedded
    // double-quotes are doubled. JSON.stringify produces "" around keys so
    // each is doubled to "" twice in the CSV form.
    expect(csv).toContain('"{""reason"":""spam"",""count"":3}"');
  });

  it('treats null actor/target as empty fields', () => {
    const csv = rowsToCsv([row({
      actorId: null, actorDisplayName: null,
      targetId: null, targetDisplayName: null, targetType: null,
    })]);
    const cells = stripBom(csv).split('\r\n')[1]?.split(',') ?? [];
    expect(cells[3]).toBe(''); // actor_id
    expect(cells[4]).toBe(''); // actor
    expect(cells[5]).toBe(''); // target_type
    expect(cells[6]).toBe(''); // target_id
    expect(cells[7]).toBe(''); // target
  });

  it('neutralizes spreadsheet formula injection in user-controlled fields', () => {
    const csv = rowsToCsv([
      row({ actorDisplayName: '+1+2' }),
      row({ eventId: 'e-2', actorDisplayName: '-cmd' }),
      row({ eventId: 'e-3', actorDisplayName: '@SUM(A1)' }),
      row({ eventId: 'e-4', actorDisplayName: '=HYPERLINK("http://evil","x")' }),
    ]);
    const lines = stripBom(csv).split('\r\n');
    // Leading formula triggers (= + - @) are prefixed with a single quote so the
    // value is treated as text by Excel / Sheets. The actor column is index 4.
    expect(lines[1].split(',')[4]).toBe(`'+1+2`);
    expect(lines[2].split(',')[4]).toBe(`'-cmd`);
    expect(lines[3].split(',')[4]).toBe(`'@SUM(A1)`);
    // The HYPERLINK payload contains a comma, so after the quote prefix it is
    // also RFC-4180 quoted (embedded quotes doubled).
    expect(lines[4]).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
});

describe('isCsvExportSupported', () => {
  it('returns true only on web platform', () => {
    Platform.OS = 'web';
    expect(isCsvExportSupported()).toBe(true);

    Platform.OS = 'ios';
    expect(isCsvExportSupported()).toBe(false);

    Platform.OS = 'android';
    expect(isCsvExportSupported()).toBe(false);
  });
});

describe('downloadAuditCsv', () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    Platform.OS = 'web';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  it('returns false when platform is not web', () => {
    Platform.OS = 'ios';
    expect(downloadAuditCsv([row()], 'audit.csv')).toBe(false);
  });

  it('returns false when window or document is undefined on web', () => {
    Platform.OS = 'web';
    // @ts-expect-error simulating non-browser
    delete globalThis.window;
    // @ts-expect-error simulating non-browser
    delete globalThis.document;

    expect(downloadAuditCsv([row()], 'audit.csv')).toBe(false);
  });

  it('triggers browser download link and revokes object URL on web', () => {
    Platform.OS = 'web';

    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-uuid');
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    const mockClick = vi.fn();
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();
    const mockAnchor = {
      href: '',
      download: '',
      style: { display: '' },
      click: mockClick,
    };

    globalThis.window = {} as unknown as Window & typeof globalThis;
    globalThis.document = {
      body: {
        appendChild: mockAppendChild,
        removeChild: mockRemoveChild,
      },
      createElement: vi.fn((tagName: string) => {
        if (tagName === 'a') return mockAnchor;
        return {};
      }),
    } as unknown as Document;

    const success = downloadAuditCsv([row()], 'audit.csv');

    expect(success).toBe(true);
    expect(mockCreateObjectURL).toHaveBeenCalledTimes(1);
    expect(mockClick).toHaveBeenCalledTimes(1);
    expect(mockAppendChild).toHaveBeenCalledWith(mockAnchor);
    expect(mockRemoveChild).toHaveBeenCalledWith(mockAnchor);
  });
});
