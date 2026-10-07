import * as SecureStore from 'expo-secure-store';

/**
 * Key-value storage backed by the iOS Keychain / Android Keystore.
 *
 * Supabase sessions (JWT + refresh token + user) are often larger than the
 * ~2 KB some platforms accept per SecureStore item, so values are split into
 * chunks. Layout for key K:
 *   K          → manifest JSON {"v":1,"n":<chunk count>}
 *   K.__0..n-1 → chunks
 *
 * Writes store chunks first and the manifest last, so a crash mid-write never
 * leaves a manifest pointing at missing data. Reads that find an incomplete
 * set return null (treated as "signed out") instead of a corrupt session.
 */

// 600 UTF-16 code units ≤ 1800 UTF-8 bytes even for 3-byte characters.
const CHUNK_SIZE = 600;
const MANIFEST_VERSION = 1;

const OPTIONS: SecureStore.SecureStoreOptions = {
  // Available after first unlock so background tasks can refresh tokens;
  // THIS_DEVICE_ONLY keeps tokens out of backups and device migrations.
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

interface Manifest {
  v: number;
  n: number;
}

const chunkKey = (key: string, index: number) => `${key}.__${index}`;

/** SecureStore keys may only contain alphanumerics, ".", "-" and "_". */
function assertValidKey(key: string): void {
  if (!/^[\w.-]+$/.test(key)) throw new Error(`Invalid secure storage key: ${key}`);
}

function parseManifest(raw: string | null): Manifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Manifest>;
    if (parsed.v === MANIFEST_VERSION && Number.isInteger(parsed.n) && (parsed.n ?? -1) >= 0) {
      return { v: parsed.v, n: parsed.n as number };
    }
  } catch {
    // fall through
  }
  return null;
}

async function removeChunks(key: string, from: number, to: number): Promise<void> {
  for (let i = from; i < to; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), OPTIONS);
  }
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    assertValidKey(key);
    const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    if (!manifest) return null;

    const parts: string[] = [];
    for (let i = 0; i < manifest.n; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i), OPTIONS);
      if (part === null) {
        await this.removeItem(key);
        return null;
      }
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    assertValidKey(key);
    const previous = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    const count = Math.ceil(value.length / CHUNK_SIZE);

    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(
        chunkKey(key, i),
        value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        OPTIONS,
      );
    }
    await SecureStore.setItemAsync(key, JSON.stringify({ v: MANIFEST_VERSION, n: count }), OPTIONS);
    if (previous && previous.n > count) await removeChunks(key, count, previous.n);
  },

  async removeItem(key: string): Promise<void> {
    assertValidKey(key);
    const manifest = parseManifest(await SecureStore.getItemAsync(key, OPTIONS));
    await SecureStore.deleteItemAsync(key, OPTIONS);
    if (manifest) await removeChunks(key, 0, manifest.n);
  },
};
