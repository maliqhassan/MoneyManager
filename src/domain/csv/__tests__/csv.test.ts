import {
  detectDelimiter,
  parseCsv,
  protectText,
  quoteCell,
  readRecords,
  stripBom,
  toCsv,
} from '../csv';

describe('CSV reading', () => {
  it('handles quoted commas, escaped quotes and line breaks inside quotes', () => {
    const csv =
      'Date,Payee,Amount\n2026-10-01,"Smith, John","-12.50"\n2026-10-02,"He said ""hi""",3\n2026-10-03,"two\nlines",4\n';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(['Date', 'Payee', 'Amount']);
    expect(r.records.map((x) => x.cells)).toEqual([
      ['2026-10-01', 'Smith, John', '-12.50'],
      ['2026-10-02', 'He said "hi"', '3'],
      ['2026-10-03', 'two\nlines', '4'],
    ]);
    expect(r.records.map((x) => x.line)).toEqual([2, 3, 4]);
    expect(r.errors).toEqual([]);
  });

  it('accepts CRLF, LF and CR line endings and a UTF-8 BOM', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const r = parseCsv(`\uFEFFa,b${eol}1,2${eol}3,4${eol}`);
      expect(r.headers).toEqual(['a', 'b']);
      expect(r.records.map((x) => x.cells)).toEqual([
        ['1', '2'],
        ['3', '4'],
      ]);
    }
    expect(stripBom('\uFEFFx')).toBe('x');
    expect(stripBom('x')).toBe('x');
    // CRLF inside quotes keeps the value and counts lines correctly.
    const r = parseCsv('a,b\r\n"x\r\ny",1\r\nz,2');
    expect(r.records).toEqual([
      { line: 2, cells: ['x\r\ny', '1'] },
      { line: 4, cells: ['z', '2'] },
    ]);
  });

  it('skips empty rows and reports line numbers of malformed ones', () => {
    const r = parseCsv('a,b\n\n1,2\n   \n3,4,5\n6\n,,\n7,"8\n');
    expect(r.records).toEqual([
      { line: 3, cells: ['1', '2'] },
      { line: 6, cells: ['6', ''] }, // trailing empty field omitted → padded
      // line 8 never closes its quote: reported, not imported
    ]);
    expect(r.errors).toEqual([
      { line: 5, code: 'field_count', expected: 2, found: 3 },
      { line: 8, code: 'unterminated_quote' },
    ]);
  });

  it('reports text after a closing quote', () => {
    expect(readRecords('"ab"c,d', ',').errors).toEqual([{ line: 1, code: 'text_after_quote' }]);
    expect(readRecords('"ab"c,d\ne,f', ',').records).toEqual([{ line: 2, cells: ['e', 'f'] }]);
    expect(readRecords('"ab"  ,d', ',').records[0]!.cells).toEqual(['ab', 'd']);
  });

  it('names blank and duplicate headers uniquely', () => {
    expect(parseCsv('Amount,,amount,Amount\n1,2,3,4').headers).toEqual([
      'Amount',
      'Column 2',
      'amount (2)',
      'Amount (3)',
    ]);
    expect(parseCsv('')).toMatchObject({ headers: [], records: [], errors: [] });
  });

  it('detects the delimiter outside quotes', () => {
    expect(detectDelimiter('a;b;c\n1;"2,5";3\n')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('date,payee\n"1;2",x')).toBe(',');
    expect(detectDelimiter('single')).toBe(',');
    expect(parseCsv('a;b\n1,5;2').records[0]!.cells).toEqual(['1,5', '2']);
  });

  it('parses a large file', () => {
    const lines = ['date,amount,payee'];
    for (let i = 0; i < 20_000; i += 1) lines.push(`2026-01-01,-${i}.00,"Shop, ${i}"`);
    const r = parseCsv(lines.join('\n'));
    expect(r.records).toHaveLength(20_000);
    expect(r.records[19_999]!.cells).toEqual(['2026-01-01', '-19999.00', 'Shop, 19999']);
  });
});

describe('CSV writing', () => {
  it('quotes when needed and round-trips through the reader', () => {
    const rows = [
      ['a', 'b'],
      ['Smith, John', 'say "hi"'],
      ['line\nbreak', ' padded '],
      ['Ünïcödé €', '日本'],
    ];
    const text = toCsv(rows);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(parseCsv(text).records.map((r) => r.cells)).toEqual(rows.slice(1));
    expect(quoteCell('x;y', ';')).toBe('"x;y"');
    expect(quoteCell('plain')).toBe('plain');
  });

  it('protects free text against formula injection', () => {
    expect(['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx'].map(protectText)).toEqual([
      "'=SUM(A1)",
      "'+1",
      "'-2",
      "'@cmd",
      "'\tx",
      "'\rx",
    ]);
    expect(protectText('Coffee = good')).toBe('Coffee = good');
  });
});
