import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Button, Card, ChoiceChips, Icon, Screen, SwitchRow, Text } from '@/components/ui';
import { REMINDER_LEAD_DAYS } from '@/domain/planning/reminders';
import { createExpoNotificationsPort } from '@/services/reminders/notificationsPort';
import { REMINDER_TIMES, useReminderSettings } from '@/stores/reminderSettingsStore';
import { makeStyles } from '@/theme';

/**
 * Reminder settings for this device. Permission is requested only when the
 * user turns reminders on, after the explanation; the app works fully
 * without it.
 */
export default function RemindersScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const settings = useReminderSettings();
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = async (on: boolean) => {
    if (!on) {
      settings.set({ enabled: false });
      return;
    }
    setBusy(true);
    try {
      const port = createExpoNotificationsPort(t('reminders.channel'));
      let state = await port.permission();
      if (state !== 'granted') state = await port.requestPermission();
      setDenied(state !== 'granted');
      settings.set({ enabled: state === 'granted' });
    } catch {
      setDenied(true);
      settings.set({ enabled: false });
    } finally {
      setBusy(false);
    }
  };

  const leadLabel = (d: number) =>
    d === 0 ? t('recurring.reminderSameDay') : t('recurring.reminderDaysBefore', { count: d });

  return (
    <Screen>
      <Text variant="body" tone="textSecondary">
        {t('reminders.intro')}
      </Text>
      <Card>
        <View style={styles.group}>
          <SwitchRow
            label={t('reminders.enable')}
            hint={t('reminders.enableHint')}
            value={settings.enabled}
            disabled={busy}
            onValueChange={(on) => void toggle(on)}
          />
          {denied ? (
            <View style={styles.group} accessibilityLiveRegion="polite">
              <View style={styles.notice}>
                <Icon name="notifications-off-outline" size={18} tone="warning" />
                <Text variant="bodySmall" tone="warning" style={styles.flex}>
                  {t('reminders.permissionDenied')}
                </Text>
              </View>
              <Button
                label={t('reminders.openSettings')}
                variant="secondary"
                size="md"
                onPress={() => void Linking.openSettings()}
              />
            </View>
          ) : null}
        </View>
      </Card>

      <ChoiceChips
        label={t('reminders.defaultLead')}
        value={String(settings.defaultLeadDays)}
        onChange={(v) => settings.set({ defaultLeadDays: Number(v) })}
        choices={REMINDER_LEAD_DAYS.map((d) => ({ value: String(d), label: leadLabel(d) }))}
      />
      <ChoiceChips
        label={t('reminders.time')}
        value={settings.time}
        onChange={(time) => settings.set({ time })}
        choices={REMINDER_TIMES.map((time) => ({ value: time, label: time }))}
      />
      <Text variant="caption" tone="textSecondary">
        {t('reminders.timing')}
      </Text>
      <Text variant="caption" tone="textSecondary">
        {t('reminders.perItem')}
      </Text>
    </Screen>
  );
}

const useStyles = makeStyles((t) => ({
  group: { gap: t.spacing.sm },
  notice: { flexDirection: 'row', gap: t.spacing.xs, alignItems: 'flex-start' },
  flex: { flex: 1 },
}));
