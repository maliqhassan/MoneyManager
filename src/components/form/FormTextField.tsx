import { type Control, Controller, type FieldPath, type FieldValues } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TextField, type TextFieldProps } from '../ui/TextField';
import { translateMessage } from './translateMessage';

export interface FormTextFieldProps<T extends FieldValues> extends Omit<
  TextFieldProps,
  'value' | 'onChangeText' | 'onBlur' | 'error'
> {
  control: Control<T>;
  name: FieldPath<T>;
}

/**
 * TextField bound to React Hook Form. Zod error messages are i18n keys and are
 * translated here, so schemas stay language-neutral.
 */
export function FormTextField<T extends FieldValues>({
  control,
  name,
  ...fieldProps
}: FormTextFieldProps<T>) {
  const { t } = useTranslation();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { value, onChange, onBlur, ref }, fieldState: { error } }) => (
        <TextField
          ref={ref}
          value={typeof value === 'string' ? value : ''}
          onChangeText={onChange}
          onBlur={onBlur}
          error={error?.message ? translateMessage(t, error.message) : null}
          {...fieldProps}
        />
      )}
    />
  );
}
