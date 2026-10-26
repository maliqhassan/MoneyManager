import { FONT_DISPLAY, FONT_TEXT, radius, spacing, typography } from '../tokens';

describe('type scale', () => {
  const styles = Object.entries(typography);

  it.each(styles)('%s uses one of the two embedded typefaces', (_name, style) => {
    expect([FONT_DISPLAY, FONT_TEXT]).toContain(style.fontFamily);
  });

  it.each(styles)('%s is at least 12 pt with a line height on the 2-pt grid', (_name, style) => {
    expect(style.fontSize).toBeGreaterThanOrEqual(12);
    expect(style.lineHeight % 2).toBe(0);
    expect(style.lineHeight).toBeGreaterThanOrEqual(style.fontSize);
  });

  it('keeps a small, deliberate set of sizes', () => {
    const sizes = [...new Set(styles.map(([, s]) => s.fontSize))].sort((a, b) => a - b);
    expect(sizes).toEqual([12, 14, 16, 20, 28, 36]);
  });

  it('tightens tracking as size grows; all-caps labels are letter-spaced', () => {
    expect(typography.display.letterSpacing).toBeLessThan(typography.heading.letterSpacing);
    expect(typography.overline.textTransform).toBe('uppercase');
    expect(typography.overline.letterSpacing).toBeGreaterThan(0.06 * typography.overline.fontSize);
  });

  it('amounts use tabular figures', () => {
    expect(typography.amount.fontVariant).toContain('tabular-nums');
    expect(typography.amountLarge.fontVariant).toContain('tabular-nums');
  });
});

describe('spacing and radius', () => {
  it('stay on the 4-pt grid', () => {
    for (const value of Object.values(spacing)) {
      if (value > 2) expect(value % 4).toBe(0);
    }
    for (const value of Object.values(radius)) {
      if (value < 999) expect(value % 4).toBe(0);
    }
  });
});
