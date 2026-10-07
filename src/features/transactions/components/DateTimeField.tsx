import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { BottomSheet, Button, Icon, Text } from '@/components/ui';
import { formatCalendarDate } from '@/domain/dates/calendar';
import { useFormatter } from '@/i18n/FormatContext';
import { makeStyles, useTheme } from '@/theme';

/**
 * Date + time entry. The native picker works with device-local Date
 * objects, so only the wall-clock COMPONENTS are exchanged with it; they are
 * interpreted in the user's configured time zone by the repository. This
 * keeps dates correct even when the device and the user's preference differ.
 */

function toPickerDate(date: string, time: string): Date {
  const [y = 1970, m = 1, d = 1] = date.split('-').map(Number);
  const [hh = 0, mm = 0] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

function fromPickerDate(value: Date): { date: string; time: string } {
  return {
    date: formatCalendarDate({
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate(),
    }),
    time: `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`,
  };
}

export interface DateTimeFieldProps {
  date: string;
  time: string;
  onChange: (next: { date: string; time: string }) => void;
  showTime?: boolean;
  /** Field label (defaults to "Date" / "Date · Time"). */
  label?: string;
  disabled?: boolean;
}

export function DateTimeField({
  date,
  time,
  onChange,
  showTime = true,
  label,
  disabled = false,
}: DateTimeFieldProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useStyles();
  const formatter = useFormatter();
  const [iosMode, setIosMode] = useState<'date' | 'time' | null>(null);
  const [draft, setDraft] = useState<Date>(() => toPickerDate(date, time));

  const open = (mode: 'date' | 'time') => {
    const value = toPickerDate(date, time);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        onChange: (event: DateTimePickerEvent, picked?: Date) => {
          if (event.type === 'set' && picked) onChange(fromPickerDate(picked));
        },
      });
    } else {
      setDraft(value);
      setIosMode(mode);
    }
  };

  const field = (
    mode: 'date' | 'time',
    label: string,
    value: string,
    icon: 'calendar-outline' | 'time-outline',
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => open(mode)}
      style={({ pressed }) => [
        styles.field,
        (pressed || disabled) && { backgroundColor: theme.colors.surfaceMuted },
      ]}
    >
      <Icon name={icon} size={18} tone="textSecondary" />
      <Text variant="body" numberOfLines={1} style={styles.value}>
        {value}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary">
        {label ??
          (showTime
            ? `${t('transactions.fields.date')} · ${t('transactions.fields.time')}`
            : t('transactions.fields.date'))}
      </Text>
      <View style={styles.row}>
        <View style={styles.dateCell}>
          {field(
            'date',
            label ?? t('transactions.fields.date'),
            formatter.date(date, 'medium'),
            'calendar-outline',
          )}
        </View>
        {showTime ? (
          <View style={styles.timeCell}>
            {field('time', t('transactions.fields.time'), formatter.time(time), 'time-outline')}
          </View>
        ) : null}
      </View>

      {Platform.OS !== 'android' ? (
        <BottomSheet
          visible={iosMode !== null}
          onClose={() => setIosMode(null)}
          title={iosMode === 'time' ? t('transactions.fields.time') : t('transactions.fields.date')}
          closeLabel={t('common.close')}
        >
          {iosMode ? (
            <DateTimePicker
              value={draft}
              mode={iosMode}
              display={iosMode === 'date' ? 'inline' : 'spinner'}
              onChange={(_event, picked) => picked && setDraft(picked)}
              themeVariant={theme.scheme}
              accentColor={theme.colors.primary}
            />
          ) : null}
          <Button
            label={t('common.done')}
            onPress={() => {
              onChange(fromPickerDate(draft));
              setIosMode(null);
            }}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.xs },
  row: { flexDirection: 'row', gap: t.spacing.sm },
  dateCell: { flex: 2 },
  timeCell: { flex: 1 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing.sm,
    minHeight: 52,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.colors.borderStrong,
    backgroundColor: t.colors.surface,
    paddingHorizontal: t.spacing.md,
  },
  value: { flex: 1 },
}));
