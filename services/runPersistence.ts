import type {
  NicheIdea,
  NichePreflight,
  NicheVisualAnalysis,
  MarketingAsset,
  ProductionMetrics,
  ProductionRunMode,
  QualityReport,
  Sticker,
  StylePreset
} from '../types';

const DATABASE_NAME = 'stickeros-production';
const DATABASE_VERSION = 2;
const ACTIVE_CHECKPOINT_KEY = 'active';
export const checkpointChangedEventName = 'stickeros:checkpoint-changed';

export interface RunCheckpointMeta {
  id: string;
  updatedAt: string;
  currentNiche: NicheIdea;
  currentStyle: StylePreset;
  runMode: ProductionRunMode;
  targetCount: number;
  useTurbo: boolean;
  allowRiskyNiche: boolean;
  analysis?: NicheVisualAnalysis;
  qualityReport: QualityReport | null;
  metrics: ProductionMetrics;
  preflight: NichePreflight | null;
  rawListing?: string;
  logs: string[];
}

type StickerRevision = Sticker & {
  contentFingerprint?: string;
  checkpointSavedAt?: string;
};

type MarketingAssetRevision = MarketingAsset & {
  sourceStickerIds?: number[];
  sourceSignature?: string;
};

interface PersistedSticker extends Omit<StickerRevision, 'url'> {
  key: string;
  runId: string;
  url: null;
}

export interface LoadedRunCheckpoint {
  meta: RunCheckpointMeta;
  stickers: StickerRevision[];
  marketingAssets: MarketingAssetRevision[];
}

interface PersistedMarketingAsset extends Omit<MarketingAssetRevision, 'url'> {
  key: string;
  runId: string;
  url: null;
  blob?: Blob;
}

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    if (!database.objectStoreNames.contains('stickers')) {
      const store = database.createObjectStore('stickers', { keyPath: 'key' });
      store.createIndex('runId', 'runId', { unique: false });
    }
    if (!database.objectStoreNames.contains('assets')) {
      const store = database.createObjectStore('assets', { keyPath: 'key' });
      store.createIndex('runId', 'runId', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open the production checkpoint database.'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Checkpoint transaction failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('Checkpoint transaction was aborted.'));
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const dispatchStickerChanges = (runId: string, stickerIds: number[]) => {
  if (!stickerIds.length || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(checkpointChangedEventName, {
    detail: { runId, stickerIds: [...new Set(stickerIds)].sort((a, b) => a - b) }
  }));
};

const blobFingerprint = async (blob?: Blob) => {
  if (!blob?.size) return 'no-blob';
  const sampleSize = 4096;
  const middleStart = Math.max(0, Math.floor(blob.size / 2) - Math.floor(sampleSize / 2));
  const slices = [
    blob.slice(0, Math.min(sampleSize, blob.size)),
    blob.slice(middleStart, Math.min(blob.size, middleStart + sampleSize)),
    blob.slice(Math.max(0, blob.size - sampleSize), blob.size)
  ];
  const buffers = await Promise.all(slices.map(slice => slice.arrayBuffer()));
  const prefix = new TextEncoder().encode(`${blob.type}:${blob.size}:`);
  const total = prefix.byteLength + buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
  const bytes = new Uint8Array(total);
  bytes.set(prefix, 0);
  let offset = prefix.byteLength;
  buffers.forEach(buffer => {
    bytes.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  });
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};

const withFingerprint = async (record?: PersistedSticker) => {
  if (!record || record.contentFingerprint) return record;
  return { ...record, contentFingerprint: await blobFingerprint(record.blob) };
};

const buildPersistedSticker = async (runId: string, sticker: Sticker): Promise<PersistedSticker> => ({
  ...sticker,
  key: `${runId}:${sticker.id}`,
  runId,
  url: null,
  contentFingerprint: await blobFingerprint(sticker.blob),
  checkpointSavedAt: new Date().toISOString()
});

const sameRecord = (left: PersistedSticker | undefined, right: PersistedSticker) => Boolean(left)
  && left!.contentFingerprint === right.contentFingerprint
  && left!.prompt === right.prompt
  && left!.status === right.status
  && left!.qaStatus === right.qaStatus;

const pixelsChanged = (left: PersistedSticker | undefined, right: PersistedSticker) =>
  !left || left.contentFingerprint !== right.contentFingerprint;

const readPersistedSticker = async (database: IDBDatabase, key: string) => {
  const transaction = database.transaction('stickers', 'readonly');
  const result = await requestResult<PersistedSticker | undefined>(transaction.objectStore('stickers').get(key));
  await transactionDone(transaction);
  return result;
};

const readPersistedStickers = async (database: IDBDatabase, runId: string) => {
  const transaction = database.transaction('stickers', 'readonly');
  const records = await requestResult<PersistedSticker[]>(transaction.objectStore('stickers').index('runId').getAll(runId));
  await transactionDone(transaction);
  return (records || []).sort((left, right) => left.id - right.id);
};

const previewSource = (assetId: string, records: PersistedSticker[], targetCount: number) => {
  const match = assetId.match(/^preview_(\d+)$/);
  if (!match) return null;
  const page = Math.max(0, Number(match[1]) - 1);
  const catalog = records
    .filter(sticker => sticker.status === 'completed' && sticker.blob?.size && sticker.qaStatus !== 'rejected')
    .slice(0, targetCount);
  const selected = catalog.slice(page * 17, Math.min(catalog.length, page * 17 + 17));
  return {
    ids: selected.map(sticker => sticker.id),
    signature: selected.map(sticker => `${sticker.id}:${sticker.contentFingerprint || sticker.blob?.size || 0}`).join('|')
  };
};

export const saveRunCheckpointMeta = async (meta: RunCheckpointMeta) => {
  const database = await openDatabase();
  const transaction = database.transaction('meta', 'readwrite');
  transaction.objectStore('meta').put({ key: ACTIVE_CHECKPOINT_KEY, ...meta, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  database.close();
};

export const saveStickerCheckpoint = async (runId: string, sticker: Sticker) => {
  const persisted = await buildPersistedSticker(runId, sticker);
  const database = await openDatabase();
  const existing = await withFingerprint(await readPersistedSticker(database, persisted.key));
  const pixelChange = pixelsChanged(existing, persisted);
  if (sameRecord(existing, persisted) && existing?.checkpointSavedAt) persisted.checkpointSavedAt = existing.checkpointSavedAt;
  const transaction = database.transaction('stickers', 'readwrite');
  transaction.objectStore('stickers').put(persisted);
  await transactionDone(transaction);
  database.close();
  if (pixelChange) dispatchStickerChanges(runId, [sticker.id]);
};

export const saveStickerCheckpoints = async (runId: string, stickers: Sticker[]) => {
  const prepared = await Promise.all(stickers.map(sticker => buildPersistedSticker(runId, sticker)));
  const database = await openDatabase();
  const existingRaw = await readPersistedStickers(database, runId);
  const existing = (await Promise.all(existingRaw.map(record => withFingerprint(record))))
    .filter((record): record is PersistedSticker => Boolean(record));
  const existingById = new Map(existing.map(sticker => [sticker.id, sticker]));
  const changedPixelIds: number[] = [];
  prepared.forEach(record => {
    const previous = existingById.get(record.id);
    if (sameRecord(previous, record)) {
      if (previous?.checkpointSavedAt) record.checkpointSavedAt = previous.checkpointSavedAt;
    }
    if (pixelsChanged(previous, record)) changedPixelIds.push(record.id);
  });
  const transaction = database.transaction('stickers', 'readwrite');
  const store = transaction.objectStore('stickers');
  prepared.forEach(record => store.put(record));
  await transactionDone(transaction);
  database.close();
  dispatchStickerChanges(runId, changedPixelIds);
};

export const saveMarketingAssetCheckpoint = async (runId: string, asset: MarketingAsset) => {
  if (!asset.id || !asset.url || asset.status !== 'completed') return;
  const blob = await fetch(asset.url).then(response => {
    if (!response.ok) throw new Error(`Could not persist marketing asset ${asset.id}.`);
    return response.blob();
  });
  const database = await openDatabase();
  const metaTransaction = database.transaction('meta', 'readonly');
  const meta = await requestResult<(RunCheckpointMeta & { key: string }) | undefined>(metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY));
  await transactionDone(metaTransaction);
  const recordsRaw = asset.id.startsWith('preview_') ? await readPersistedStickers(database, runId) : [];
  const records = (await Promise.all(recordsRaw.map(record => withFingerprint(record))))
    .filter((record): record is PersistedSticker => Boolean(record));
  const source = asset.id.startsWith('preview_')
    ? previewSource(asset.id, records, meta?.targetCount || records.length)
    : null;
  const transaction = database.transaction('assets', 'readwrite');
  const persisted: PersistedMarketingAsset = {
    ...asset,
    ...(source ? { sourceStickerIds: source.ids, sourceSignature: source.signature } : {}),
    key: `${runId}:${asset.id}`,
    runId,
    url: null,
    blob
  };
  transaction.objectStore('assets').put(persisted);
  await transactionDone(transaction);
  database.close();
};

export const loadRunCheckpoint = async (): Promise<LoadedRunCheckpoint | null> => {
  const database = await openDatabase();
  const metaTransaction = database.transaction('meta', 'readonly');
  const meta = await requestResult<(RunCheckpointMeta & { key: string }) | undefined>(metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY));
  await transactionDone(metaTransaction);
  if (!meta) {
    database.close();
    return null;
  }

  const persisted = await readPersistedStickers(database, meta.id);
  const stickers = persisted.map(record => {
    const { key: _key, runId: _runId, ...sticker } = record;
    return {
      ...sticker,
      status: sticker.status === 'generating' ? 'pending' as const : sticker.status,
      url: sticker.blob ? URL.createObjectURL(sticker.blob) : null
    };
  });

  const assetTransaction = database.transaction('assets', 'readonly');
  const persistedAssets = await requestResult<PersistedMarketingAsset[]>(assetTransaction.objectStore('assets').index('runId').getAll(meta.id));
  await transactionDone(assetTransaction);
  const marketingAssets = (persistedAssets || []).map(record => {
    const { key: _key, runId: _runId, blob, ...asset } = record;
    return { ...asset, url: blob ? URL.createObjectURL(blob) : null };
  });
  database.close();
  const { key: _key, ...checkpointMeta } = meta;
  return { meta: checkpointMeta, stickers, marketingAssets };
};

export const clearRunCheckpoint = async () => {
  const database = await openDatabase();
  const metaTransaction = database.transaction('meta', 'readonly');
  const meta = await requestResult<(RunCheckpointMeta & { key: string }) | undefined>(metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY));
  await transactionDone(metaTransaction);

  const transaction = database.transaction(['meta', 'stickers', 'assets'], 'readwrite');
  transaction.objectStore('meta').delete(ACTIVE_CHECKPOINT_KEY);
  if (meta) {
    const stickerRequest = transaction.objectStore('stickers').index('runId').openKeyCursor(IDBKeyRange.only(meta.id));
    stickerRequest.onsuccess = () => {
      const cursor = stickerRequest.result;
      if (!cursor) return;
      transaction.objectStore('stickers').delete(cursor.primaryKey);
      cursor.continue();
    };
    const assetRequest = transaction.objectStore('assets').index('runId').openKeyCursor(IDBKeyRange.only(meta.id));
    assetRequest.onsuccess = () => {
      const cursor = assetRequest.result;
      if (!cursor) return;
      transaction.objectStore('assets').delete(cursor.primaryKey);
      cursor.continue();
    };
  }
  await transactionDone(transaction);
  database.close();
};
