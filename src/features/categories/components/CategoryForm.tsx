import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { z } from 'zod';

import { FormTextField } from '@/components/form/FormTextField';
import { Button, Icon, type IconName, OptionPicker, Text } from '@/components/ui';
import { DEFAULT_CATEGORIES } from '@/domain/categories/defaults';
import type { CategoryKind } from '@/domain/enums';
import type { Category } from '@/domain/models';
import { FormError } from '@/features/auth/components/FormError';
import { toAppError } from '@/lib/errors';
import { ACCOUNT_COLORS, makeStyles, useTheme } from '@/theme';
import { hexColorSchema, nameSchema } from '@/validation/common';

import { categoryDisplayName } from '../displayName';
import { resolveCategoryColor, resolveCategoryIcon } from './CategoryIcon';

export interface CategoryFormValues {
  name: string;
  parentId: string | null;
  icon: string;
  color: string;
}

const schema = z.object({
  name: nameSchema,
  parentId: z.string().nullable(),
  icon: z.string().max(64),
  color: hexColorSchema,
});

/** One icon per default category; its translated name is the accessible label. */
const ICON_CHOICES = DEFAULT_CATEGORIES.filter(
  (c, i, all) => all.findIndex((x) => x.icon === c.icon) === i,
).map((c) => ({ icon: c.icon as IconName, key: c.key }));

export function CategoryForm({
  kind,
  initialValues,
  parents,
  selfId,
  submitLabel,
  onSubmit,
}: {
  kind: CategoryKind;
  initialValues: CategoryFormValues;
  /** Possible parents: active, top-level, same kind. */
  parents: readonly Category[];
  selfId?: string;
  submitLabel: string;
  onSubmit: (values: CategoryFormValues) => Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { control, handleSubmit, setError, formState } = useForm<CategoryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });
  const color = useWatch({ control, name: 'color' });

  const parentOptions = useMemo(
    () => [
      { value: '__none__', label: t('categories.fields.noParent') },
      ...parents
        .filter((p) => p.id !== selfId && p.kind === kind)
        .map((p) => ({ value: p.id, label: categoryDisplayName(t, p) })),
    ],
    [parents, selfId, kind, t],
  );

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await onSubmit(values);
    } catch (error) {
      const fieldErrors = toAppError(error).fieldErrors;
      if (fieldErrors?.parentId) setError('parentId', { message: fieldErrors.parentId });
      else setSubmitError(error);
    }
  });

  return (
    <View style={styles.form}>
      <FormTextField
        control={control}
        name="name"
        label={t('categories.fields.name')}
        maxLength={100}
        autoCapitalize="sentences"
      />

      <Controller
        control={control}
        name="parentId"
        render={({ field, fieldState }) => (
          <OptionPicker
            label={t('categories.fields.parent')}
            value={field.value ?? '__none__'}
            options={parentOptions}
            onChange={(v) => field.onChange(v === '__none__' ? null : v)}
            hint={
              fieldState.error?.message
                ? t(fieldState.error.message as 'categories.errors.tooDeep')
                : undefined
            }
          />
        )}
      />

      <Controller
        control={control}
        name="icon"
        render={({ field }) => (
          <View style={styles.section}>
            <Text variant="label" tone="textSecondary">
              {t('categories.fields.icon')}
            </Text>
            <View style={styles.grid} accessibilityRole="radiogroup">
              {ICON_CHOICES.map(({ icon, key }) => {
                const selected = resolveCategoryIcon(field.value) === icon;
                return (
                  <Pressable
                    key={icon}
                    accessibilityRole="radio"
                    accessibilityLabel={t(
                      `categories.system.${key}` as 'categories.system.housing',
                    )}
                    accessibilityState={{ selected, checked: selected }}
                    onPress={() => field.onChange(icon)}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: selected
                          ? resolveCategoryColor(color)
                          : theme.colors.surfaceMuted,
                        borderColor: selected ? theme.colors.text : 'transparent',
                      },
                    ]}
                  >
                    <Icon name={icon} size={20} tone={selected ? 'onAccent' : 'textSecondary'} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      />

      <Controller
        control={control}
        name="color"
        render={({ field }) => (
          <View style={styles.section}>
            <Text variant="label" tone="textSecondary">
              {t('categories.fields.color')}
            </Text>
            <View style={styles.grid} accessibilityRole="radiogroup">
              {ACCOUNT_COLORS.map((c, index) => {
                const selected = c.toLowerCase() === field.value.toLowerCase();
                const colorName =
                  (
                    [
                      'blue',
                      'green',
                      'teal',
                      'violet',
                      'pink',
                      'red',
                      'orange',
                      'amber',
                      'slate',
                      'navy',
                    ] as const
                  )[index] ?? 'slate';
                return (
                  <Pressable
                    key={c}
                    accessibilityRole="radio"
                    accessibilityLabel={t(`accounts.colorNames.${colorName}`)}
                    accessibilityState={{ selected, checked: selected }}
                    onPress={() => field.onChange(c)}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: c,
                        borderColor: selected ? theme.colors.text : 'transparent',
                      },
                    ]}
                  >
                    {selected ? <Icon name="checkmark" size={20} tone="onAccent" /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
      />

      <FormError error={submitError} />
      <Button label={submitLabel} loading={formState.isSubmitting} onPress={submit} />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  form: { gap: t.spacing.lg },
  section: { gap: t.spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  cell: {
    width: t.minTouchTarget,
    height: t.minTouchTarget,
    borderRadius: t.minTouchTarget / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
