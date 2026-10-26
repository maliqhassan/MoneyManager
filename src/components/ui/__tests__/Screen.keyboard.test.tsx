import { act, fireEvent, screen } from '@testing-library/react-native';
import { DeviceEventEmitter, Platform, Text } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { Screen } from '../Screen';
import { TextField } from '../TextField';

const SHOW = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
const HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

type Measurable = {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
};

/** The ref target: in Jest, View is a mocked class component above the host element. */
function measurable(element: ReturnType<typeof screen.getByTestId>): Measurable {
  let fiber = (element as unknown as { instance: { unstable_fiber: Fiber } }).instance
    .unstable_fiber;
  while (fiber && !(fiber.stateNode && 'measureInWindow' in fiber.stateNode)) fiber = fiber.return!;
  return fiber.stateNode as Measurable;
}
type Fiber = { stateNode: object | null; return: Fiber | null };

/** The body view sits at y=100 and is 600 tall in the window (bottom edge 700). */
function placeBody() {
  const body = screen.getByTestId('screen-body');
  measurable(body).measureInWindow = (cb) => cb(0, 100, 400, 600);
  return body;
}

const keyboard = (screenY: number, height: number) =>
  act(() => {
    DeviceEventEmitter.emit(SHOW, {
      endCoordinates: { screenX: 0, screenY, width: 400, height },
      duration: 0,
      easing: 'keyboard',
    });
  });

async function renderForm() {
  await renderWithProviders(
    <Screen keyboard footer={<Text>Save</Text>}>
      <TextField label="Amount" defaultValue="12.50" />
      <TextField label="Notes" />
    </Screen>,
  );
  return placeBody();
}

describe('Screen keyboard handling', () => {
  it('lifts the content and the footer by exactly the keyboard overlap', async () => {
    const body = await renderForm();
    await keyboard(450, 350); // keyboard top at 450 → covers 250 of the body
    expect(body).toHaveStyle({ paddingBottom: 250 });
    expect(screen.getByText('Save')).toBeOnTheScreen();

    await act(() => {
      DeviceEventEmitter.emit(HIDE, {});
    });
    expect(body).not.toHaveStyle({ paddingBottom: 250 });
  });

  it('adds nothing when the window was already resized above the keyboard', async () => {
    const body = await renderForm();
    await keyboard(760, 300); // body ends at 700, keyboard starts below it
    expect(body).not.toHaveStyle({ paddingBottom: expect.any(Number) });
  });

  it('re-measures when the layout changes while the keyboard is open', async () => {
    const body = await renderForm();
    await keyboard(450, 350);
    measurable(body).measureInWindow = (cb) => cb(0, 100, 400, 500); // e.g. a header grew
    await act(() => fireEvent(body, 'layout', { nativeEvent: { layout: {} } }));
    expect(body).toHaveStyle({ paddingBottom: 150 });
  });

  it('keeps typed values while the keyboard opens and closes', async () => {
    await renderForm();
    await fireEvent.changeText(screen.getByLabelText('Notes'), 'Lunch with Sam');
    await keyboard(450, 350);
    await act(() => {
      DeviceEventEmitter.emit(HIDE, {});
    });
    expect(screen.getByLabelText('Notes')).toHaveDisplayValue('Lunch with Sam');
    expect(screen.getByLabelText('Amount')).toHaveDisplayValue('12.50');
  });

  it('screens without the keyboard option are not padded', async () => {
    await renderWithProviders(
      <Screen>
        <Text>Report</Text>
      </Screen>,
    );
    const body = placeBody();
    await keyboard(450, 350);
    expect(body).not.toHaveStyle({ paddingBottom: 250 });
  });
});
