import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { useSyncStore } from '@/stores/syncStore';
import { showToast } from '@/stores/toastStore';

/**
 * Feedback after a local write. The write already succeeded on the device;
 * when offline we say so instead of implying it reached the server.
 */
export function toastSaved(t: TFunction, message: string): void {
  const online = useSyncStore.getState().isOnline;
  showToast(online ? message : `${message}. ${t('transactions.toast.savedOffline')}`);
}

/** Native confirm dialog with a cancel button. */
export function confirmAction(
  t: TFunction,
  options: {
    title: string;
    body: string;
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => void;
  },
): void {
  Alert.alert(options.title, options.body, [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: options.confirmLabel,
      style: options.destructive ? 'destructive' : 'default',
      onPress: options.onConfirm,
    },
  ]);
}
