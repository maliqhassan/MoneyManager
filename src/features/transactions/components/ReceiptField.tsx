import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, View } from 'react-native';

import { Button, Icon, IconButton, Text } from '@/components/ui';
import { toAppError } from '@/lib/errors';
import { persistReceipt } from '@/services/receipts/receiptFiles';
import { receiptSignedUrl } from '@/services/receipts/uploader';
import { getSupabase } from '@/services/supabase/client';
import { useSyncStore } from '@/stores/syncStore';
import { makeStyles } from '@/theme';
import type { ReceiptFile } from '@/validation/transactions';

export interface ReceiptItem {
  /** Attachment id once saved; undefined while only picked (create form). */
  id?: string;
  localUri: string | null;
  storagePath?: string;
  mimeType: string;
  fileName: string;
  uploadStatus?: 'pending' | 'uploaded' | 'failed';
}

/** Picks an image, copies it into app storage, returns validated-ready metadata. */
export async function pickReceipt(source: 'camera' | 'library'): Promise<ReceiptFile | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 0.7,
    exif: false,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return persistReceipt({
    uri: asset.uri,
    mimeType: asset.mimeType ?? null,
    fileName: asset.fileName ?? null,
    fileSize: asset.fileSize ?? null,
  });
}

function Preview({ item }: { item: ReceiptItem }) {
  const styles = useStyles();
  const isOnline = useSyncStore((s) => s.isOnline);
  const [remoteUri, setRemoteUri] = useState<string | null>(null);

  useEffect(() => {
    // Receipts added on another device are fetched with a short-lived signed URL.
    if (item.localUri || !item.storagePath || !isOnline) return;
    let cancelled = false;
    void receiptSignedUrl(getSupabase(), item.storagePath).then(
      (url) => !cancelled && setRemoteUri(url),
    );
    return () => {
      cancelled = true;
    };
  }, [item.localUri, item.storagePath, isOnline]);

  const uri = item.localUri ?? remoteUri;
  if (item.mimeType === 'application/pdf' || !uri) {
    return (
      <View style={[styles.thumb, styles.placeholder]}>
        <Icon
          name={item.mimeType === 'application/pdf' ? 'document-outline' : 'image-outline'}
          size={28}
          tone="textSecondary"
        />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={styles.thumb}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  );
}

/**
 * Receipt attachments. Files are stored on the device immediately and upload
 * in the background when online, so saving never depends on the network.
 */
export function ReceiptField({
  items,
  onAdd,
  onRemove,
}: {
  items: readonly ReceiptItem[];
  onAdd: (file: ReceiptFile) => void | Promise<void>;
  onRemove: (item: ReceiptItem) => void;
}) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);

  const add = async (source: 'camera' | 'library') => {
    setBusy(true);
    try {
      const file = await pickReceipt(source);
      if (file) await onAdd(file);
    } catch (error) {
      const fieldErrors = toAppError(error).fieldErrors;
      const key = fieldErrors ? Object.values(fieldErrors)[0] : undefined;
      Alert.alert(
        t('transactions.fields.receipt'),
        key ? t(key as 'errors.unknown') : t('errors.storage'),
      );
    } finally {
      setBusy(false);
    }
  };

  const status = (item: ReceiptItem) =>
    item.uploadStatus === 'uploaded'
      ? t('transactions.fields.receiptUploaded')
      : item.uploadStatus === 'failed'
        ? t('transactions.fields.receiptFailed')
        : item.localUri
          ? t('transactions.fields.receiptPending')
          : t('transactions.fields.receiptElsewhere');

  return (
    <View style={styles.container}>
      <Text variant="label" tone="textSecondary">
        {t('transactions.fields.receipt')}
      </Text>
      {items.map((item, index) => (
        <View key={item.id ?? item.localUri ?? index} style={styles.item}>
          <Preview item={item} />
          <View style={styles.itemText}>
            <Text variant="body" numberOfLines={1}>
              {item.fileName}
            </Text>
            <Text variant="bodySmall" tone="textSecondary">
              {status(item)}
            </Text>
          </View>
          <IconButton
            icon="trash-outline"
            tone="negative"
            accessibilityLabel={t('transactions.fields.removeReceipt')}
            onPress={() => onRemove(item)}
          />
        </View>
      ))}
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={t('transactions.fields.takePhoto')}
            icon="camera-outline"
            variant="secondary"
            size="md"
            loading={busy}
            onPress={() => void add('camera')}
          />
        </View>
        <View style={styles.action}>
          <Button
            label={t('transactions.fields.chooseFromLibrary')}
            icon="images-outline"
            variant="secondary"
            size="md"
            disabled={busy}
            onPress={() => void add('library')}
          />
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: { gap: t.spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: t.spacing.md },
  itemText: { flex: 1, gap: t.spacing.xxs },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: t.radius.md,
    backgroundColor: t.colors.surfaceMuted,
  },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm },
  action: { flexGrow: 1, flexBasis: 150 },
}));
