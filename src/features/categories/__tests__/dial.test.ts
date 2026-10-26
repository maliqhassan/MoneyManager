import { abbreviate } from '../components/CategoryDial';

describe('abbreviate', () => {
  it('takes the first three letters or digits, upper-cased', () => {
    expect(abbreviate('Dining out')).toBe('DIN');
    expect(abbreviate('Taxi & rideshare')).toBe('TAX');
    expect(abbreviate('A-1 Pets')).toBe('A1P');
    expect(abbreviate('Café')).toBe('CAF');
    expect(abbreviate('TV')).toBe('TV');
  });
});
