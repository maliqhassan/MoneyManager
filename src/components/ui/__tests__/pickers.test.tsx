import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { ChoiceChips } from '../ChoiceChips';
import { OptionPicker } from '../OptionPicker';

const options = [
  { value: 'USD', label: 'USD', description: 'US Dollar' },
  { value: 'EUR', label: 'EUR', description: 'Euro' },
  { value: 'GBP', label: 'GBP', description: 'British Pound' },
] as const;

describe('OptionPicker', () => {
  it('announces the current value and selects from a searchable list', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <OptionPicker
        label="Currency"
        value="USD"
        options={options}
        onChange={onChange}
        searchable
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Currency: USD' }));
    await fireEvent.changeText(screen.getByLabelText('Search'), 'pound');
    expect(screen.queryByRole('radio', { name: 'EUR, Euro' })).toBeNull();
    await fireEvent.press(screen.getByRole('radio', { name: 'GBP, British Pound' }));
    expect(onChange).toHaveBeenCalledWith('GBP');
  });

  it('shows an empty-search message', async () => {
    await renderWithProviders(
      <OptionPicker
        label="Currency"
        value="USD"
        options={options}
        onChange={jest.fn()}
        searchable
      />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Currency: USD' }));
    await fireEvent.changeText(screen.getByLabelText('Search'), 'zzz');
    expect(screen.getByText(/No matches/)).toBeOnTheScreen();
  });

  it('cannot be opened when disabled', async () => {
    await renderWithProviders(
      <OptionPicker label="Currency" value="USD" options={options} onChange={jest.fn()} disabled />,
    );
    expect(screen.getByRole('button', { name: 'Currency: USD' })).toBeDisabled();
  });
});

describe('ChoiceChips', () => {
  it('exposes radio semantics with the selected state', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <ChoiceChips
        label="First day"
        value="1"
        onChange={onChange}
        choices={[
          { value: '1', label: 'Monday' },
          { value: '0', label: 'Sunday' },
        ]}
      />,
    );
    expect(screen.getByRole('radio', { name: 'Monday' })).toBeSelected();
    await fireEvent.press(screen.getByRole('radio', { name: 'Sunday' }));
    expect(onChange).toHaveBeenCalledWith('0');
  });
});
