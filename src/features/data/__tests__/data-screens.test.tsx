import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { unzipSync, strFromU8 } from 'fflate';

import ExportScreen from '@/app/(app)/data/export';
import ImportScreen from '@/app/(app)/data/import';
import { createAccount, createLedger, type Ledger } from '@/test/ledger';
import { renderWithProviders } from '@/test/render';

import { useImportStore } from '../importStore';

const mockBack = jest.fn();
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  Stack: { Screen: () => null },
}));
jest.mock('@react-native-community/datetimepicker', () => ({
  __esModule: true,
  default: () => null,
  DateTimePickerAndroid: { open: jest.fn() },
}));

// In-memory stand-ins for the device file system, picker and share sheet.
const mockFiles = new Map<string, string | Uint8Array>();
const mockDeleted: string[] = [];
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace('file:/', 'file:///');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      const v = mockFiles.get(this.uri);
      return typeof v === 'string' ? v.length : (v?.length ?? 0);
    }
    text() {
      return Promise.resolve(String(mockFiles.get(this.uri) ?? ''));
    }
    write(content: string | Uint8Array) {
      mockFiles.set(this.uri, content);
    }
    delete() {
      mockDeleted.push(this.uri);
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return false;
    }
    list() {
      return [];
    }
    create() {}
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } } };
});
const mockGetDocument = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocument(...args),
}));
const mockShare = jest.fn((..._args: unknown[]) => Promise.resolve());
jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(true),
  shareAsync: (...args: unknown[]) => mockShare(...args),
}));

const PICKED = 'file:///cache/DocumentPicker/bank.csv';
const CSV = [
  'Date,Description,Amount,Category',
  '2026-10-01,Coffee Shop,-4.50,Groceries',
  '2026-10-02,Employer,"1,000.00",Salary',
  '2026-10-03,Broken,abc,',
].join('\n');

const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

describe('Data screens', () => {
  let L: Ledger;

  beforeEach(async () => {
    L = await createLedger();
    mockFiles.clear();
    mockDeleted.length = 0;
    mockShare.mockClear();
    mockGetDocument.mockReset();
    useImportStore.getState().reset();
  });
  afterEach(() => L.db.close());

  const pickCsv = (text: string) => {
    mockFiles.set(PICKED, text);
    mockGetDocument.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'bank.csv', uri: PICKED, size: text.length }],
    });
  };

  const walkToReview = async () => {
    await renderWithProviders(<ImportScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Step 1 of 5: File')).toBeOnTheScreen());
    await press('Choose CSV file');
    await waitFor(() => expect(screen.getByText(/3 rows · 4 columns/)).toBeOnTheScreen());
    await press('Next');
    await waitFor(() => expect(screen.getByText('Step 2 of 5: Columns')).toBeOnTheScreen());
    await press('Next');
    // Year-first dates are detected; no format has to be chosen.
    await waitFor(() => expect(screen.getByText('Step 3 of 5: Formats')).toBeOnTheScreen());
    await press('Next');
    await waitFor(() =>
      expect(screen.getByText('Step 4 of 5: Accounts & categories')).toBeOnTheScreen(),
    );
    await press('Next');
    await waitFor(() => expect(screen.getByText('Step 5 of 5: Review')).toBeOnTheScreen());
  };

  const importedCount = async () =>
    (await L.db.getFirst<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions WHERE import_batch_id IS NOT NULL AND deleted_at IS NULL`,
    ))!.n;

  it('guides a CSV import; nothing is written before the explicit confirmation', async () => {
    await createAccount(L, { openingBalanceMinor: 0 });
    pickCsv(CSV);
    await walkToReview();

    expect(screen.getByText('2 transactions will be imported')).toBeOnTheScreen();
    expect(screen.getByText(/1 row can.t be imported/)).toBeOnTheScreen();
    expect(screen.getByText(/Line 4: amount not recognised/)).toBeOnTheScreen();
    expect(await importedCount()).toBe(0);

    await press('Import 2 transactions');
    await waitFor(() => expect(screen.getByText('Import finished')).toBeOnTheScreen());
    expect(screen.getByText('2 transactions imported')).toBeOnTheScreen();
    expect(screen.getByText('1 row rejected')).toBeOnTheScreen();
    expect(await importedCount()).toBe(2);
    const rows = await L.db.getAll<{ amount_minor: number; type: string; category_id: string }>(
      `SELECT amount_minor, type, category_id FROM transactions ORDER BY local_date`,
    );
    expect(rows).toEqual([
      { amount_minor: -450, type: 'expense', category_id: L.cat.groceries },
      { amount_minor: 100_000, type: 'income', category_id: L.cat.salary },
    ]);
    // Our cached copy is removed; the original (outside the cache) is never touched.
    expect(mockDeleted).toEqual([PICKED]);
  });

  it('re-importing the same file imports nothing twice', async () => {
    await createAccount(L, { openingBalanceMinor: 0 });
    pickCsv(CSV);
    await walkToReview();
    await press('Import 2 transactions');
    await waitFor(() => expect(screen.getByText('Import finished')).toBeOnTheScreen());

    await press('Import another file');
    pickCsv(CSV);
    await waitFor(() => expect(screen.getByText('Step 1 of 5: File')).toBeOnTheScreen());
    await press('Choose CSV file');
    await waitFor(() => expect(screen.getByText(/3 rows · 4 columns/)).toBeOnTheScreen());
    for (const step of ['Columns', 'Formats', 'Accounts & categories', 'Review']) {
      await press('Next');
      await waitFor(() => expect(screen.getByText(new RegExp(`: ${step}$`))).toBeOnTheScreen());
    }
    expect(screen.getByText('2 rows were imported before — skipped')).toBeOnTheScreen();
    expect(screen.getByText('There is nothing to import.')).toBeOnTheScreen();
    expect(await importedCount()).toBe(2);
  });

  it('reports unreadable files without importing anything', async () => {
    await createAccount(L, { openingBalanceMinor: 0 });
    pickCsv('Date,Amount\n2026-10-01,"5.00\n');
    await renderWithProviders(<ImportScreen />, { ledger: L });
    await waitFor(() => expect(screen.getByText('Step 1 of 5: File')).toBeOnTheScreen());
    await press('Choose CSV file');
    await waitFor(() => expect(screen.getByText('1 line could not be read:')).toBeOnTheScreen());
    expect(screen.getByText(/a quote \(.\) is never closed/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('exports transactions as a protected CSV and hands it to the share sheet', async () => {
    const chk = await createAccount(L, { openingBalanceMinor: 0 });
    await L.repos.transactions.create({
      type: 'expense',
      accountId: chk.id,
      amountMinor: 1_234,
      localDate: '2026-10-01',
      localTime: '09:00',
      timeZone: 'America/New_York',
      categoryId: L.cat.groceries,
      payee: '=HYPERLINK("x")',
    });
    await renderWithProviders(<ExportScreen />, { ledger: L });
    await waitFor(() =>
      expect(screen.getByText(/Create a file with your MoneyManager data/)).toBeOnTheScreen(),
    );
    await press('Export and share');
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const [uri, options] = mockShare.mock.calls[0] as [string, { mimeType: string }];
    expect(options.mimeType).toBe('text/csv');
    const csv = String(mockFiles.get(uri));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('12.34');
    expect(screen.getByText(/1 transactions\)/)).toBeOnTheScreen();
  });

  it('exports everything as a ZIP with a manifest and README', async () => {
    await createAccount(L, { openingBalanceMinor: 5_000 });
    await renderWithProviders(<ExportScreen />, { ledger: L });
    await waitFor(() =>
      expect(screen.getByText(/Create a file with your MoneyManager data/)).toBeOnTheScreen(),
    );
    await fireEvent.press(screen.getByRole('radio', { name: 'Everything' }));
    await press('Export and share');
    await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
    const [uri, options] = mockShare.mock.calls[0] as [string, { mimeType: string }];
    expect(options.mimeType).toBe('application/zip');
    const entries = unzipSync(mockFiles.get(uri) as Uint8Array);
    expect(Object.keys(entries)).toEqual(
      expect.arrayContaining(['README.txt', 'manifest.json', 'transactions.csv', 'accounts.csv']),
    );
    const manifest = JSON.parse(strFromU8(entries['manifest.json']!)) as Record<string, unknown>;
    expect(manifest).toMatchObject({ formatVersion: 2, restorable: false });
  });
});
