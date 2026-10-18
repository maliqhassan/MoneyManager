import { parseCsv } from '../../csv/csv';
import {
  decimalAmount,
  type ManifestInput,
  manifestJson,
  readmeText,
  renderTable,
  TRANSACTION_COLUMNS,
} from '../export';

describe('export tables', () => {
  it('writes exact decimals, protects free text only and round-trips', () => {
    const text = renderTable({
      file: 'transactions.csv',
      columns: [
        { key: 'amount' },
        { key: 'merchant', text: true },
        { key: 'notes', text: true },
        { key: 'flag' },
        { key: 'none' },
      ],
      rows: [
        {
          amount: decimalAmount(-1_250, 'USD'),
          merchant: '=HYPERLINK("x")',
          notes: 'Café, "special"\nline',
          flag: true,
          none: null,
        },
        {
          amount: decimalAmount(1_500, 'JPY'),
          merchant: '+44 Shop',
          notes: '日本 ✓',
          flag: false,
          none: 7,
        },
      ],
    });
    expect(text.startsWith('\uFEFF')).toBe(true);
    const parsed = parseCsv(text);
    expect(parsed.headers).toEqual(['amount', 'merchant', 'notes', 'flag', 'none']);
    expect(parsed.records.map((r) => r.cells)).toEqual([
      ['-12.50', '\'=HYPERLINK("x")', 'Café, "special"\nline', 'true', ''],
      ['1500', "'+44 Shop", '日本 ✓', 'false', '7'],
    ]);
  });

  it('formats amounts by currency precision', () => {
    expect(decimalAmount(-5, 'USD')).toBe('-0.05');
    expect(decimalAmount(1_234, 'KWD')).toBe('1.234');
    expect(decimalAmount(0, 'EUR')).toBe('0.00');
  });

  it('documents relationships, conventions and limitations', () => {
    const m: ManifestInput = {
      exportedAt: '2026-10-11T10:00:00.000Z',
      appVersion: '0.1.0',
      baseCurrency: 'PKR',
      timeZone: 'Asia/Karachi',
      range: { start: '2026-01-01', end: '2026-10-11' },
      accountFilter: [],
      typeFilter: ['expense'],
      files: [{ file: 'transactions.csv', rows: 3 }],
      pendingLocalChanges: 2,
    };
    const json = JSON.parse(manifestJson(m)) as Record<string, unknown>;
    expect(json).toMatchObject({
      formatVersion: 2,
      containsUnsyncedChanges: true,
      attachmentsIncluded: false,
      restorable: false,
      transactionDateRange: { start: '2026-01-01', end: '2026-10-11' },
    });
    const readme = readmeText(m);
    expect(readme).toContain('transfer_id');
    expect(readme).toContain('2 change(s) saved on this device');
    expect(readme).toContain('Types: expense.');
    expect(
      readmeText({
        ...m,
        range: null,
        typeFilter: [],
        accountFilter: ['a'],
        pendingLocalChanges: 0,
      }),
    ).toContain('All included changes had been synced');
    expect(TRANSACTION_COLUMNS.find((c) => c.key === 'notes')?.text).toBe(true);
    expect(TRANSACTION_COLUMNS.find((c) => c.key === 'amount')?.text).toBeUndefined();
  });
});
