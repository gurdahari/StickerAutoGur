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

interface PersistedSticker extends Omit<Sticker, 'url'> {
  key: string;
  runId: string;
  url: null;
}

export interface LoadedRunCheckpoint {
  meta: RunCheckpointMeta;
  stickers: Sticker[];
  marketingAssets: MarketingAsset[];
}

interface PersistedMarketingAsset extends Omit<MarketingAsset, 'url'> {
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

export const saveRunCheckpointMeta = async (meta: RunCheckpointMeta) => {
  const database = await openDatabase();
  const transaction = database.transaction('meta', 'readwrite');
  transaction.objectStore('meta').put({ key: ACTIVE_CHECKPOINT_KEY, ...meta, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
  database.close();
};

export const saveStickerCheckpoint = async (runId: string, sticker: Sticker) => {
  const database = await openDatabase();
  const transaction = database.transaction('stickers', 'readwrite');
  const persisted: PersistedSticker = {
    ...sticker,
    key: `${runId}:${sticker.id}`,
    runId,
    url: null
  };
  transaction.objectStore('stickers').put(persisted);
  await transactionDone(transaction);
  database.close();
};

export const saveStickerCheckpoints = async (runId: string, stickers: Sticker[]) => {
  const database = await openDatabase();
  const transaction = database.transaction('stickers', 'readwrite');
  const store = transaction.objectStore('stickers');
  stickers.forEach(sticker => {
    const persisted: PersistedSticker = {
      ...sticker,
      key: `${runId}:${sticker.id}`,
      runId,
      url: null
    };
    store.put(persisted);
  });
  await transactionDone(transaction);
  database.close();
};

export const saveMarketingAssetCheckpoint = async (runId: string, asset: MarketingAsset) => {
  if (!asset.id || !asset.url || asset.status !== 'completed') return;
  const blob = await fetch(asset.url).then(response => {
    if (!response.ok) throw new Error(`Could not persist marketing asset ${asset.id}.`);
    return response.blob();
  });
  const database = await openDatabase();
  const transaction = database.transaction('assets', 'readwrite');
  const persisted: PersistedMarketingAsset = {
    ...asset,
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
  const metaRequest = metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY);
  const meta = await new Promise<(RunCheckpointMeta & { key: string }) | undefined>((resolve, reject) => {
    metaRequest.onsuccess = () => resolve(metaRequest.result);
    metaRequest.onerror = () => reject(metaRequest.error);
  });
  await transactionDone(metaTransaction);
  if (!meta) {
    database.close();
    return null;
  }

  const stickerTransaction = database.transaction('stickers', 'readonly');
  const stickerRequest = stickerTransaction.objectStore('stickers').index('runId').getAll(meta.id);
  const persisted = await new Promise<PersistedSticker[]>((resolve, reject) => {
    stickerRequest.onsuccess = () => resolve(stickerRequest.result || []);
    stickerRequest.onerror = () => reject(stickerRequest.error);
  });
  await transactionDone(stickerTransaction);

  const stickers = persisted
    .sort((left, right) => left.id - right.id)
    .map(record => {
      const { key: _key, runId: _runId, ...sticker } = record;
      return {
        ...sticker,
        status: sticker.status === 'generating' ? 'pending' as const : sticker.status,
        url: sticker.blob ? URL.createObjectURL(sticker.blob) : null
      };
    });
  const assetTransaction = database.transaction('assets', 'readonly');
  const assetRequest = assetTransaction.objectStore('assets').index('runId').getAll(meta.id);
  const persistedAssets = await new Promise<PersistedMarketingAsset[]>((resolve, reject) => {
    assetRequest.onsuccess = () => resolve(assetRequest.result || []);
    assetRequest.onerror = () => reject(assetRequest.error);
  });
  await transactionDone(assetTransaction);
  const marketingAssets = persistedAssets.map(record => {
    const { key: _key, runId: _runId, blob, ...asset } = record;
    return {
      ...asset,
      url: blob ? URL.createObjectURL(blob) : null
    };
  });
  database.close();
  const { key: _key, ...checkpointMeta } = meta;
  return { meta: checkpointMeta, stickers, marketingAssets };
};

export const clearRunCheckpoint = async () => {
  const database = await openDatabase();
  const metaTransaction = database.transaction('meta', 'readonly');
  const metaRequest = metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY);
  const meta = await new Promise<(RunCheckpointMeta & { key: string }) | undefined>((resolve, reject) => {
    metaRequest.onsuccess = () => resolve(metaRequest.result);
    metaRequest.onerror = () => reject(metaRequest.error);
  });
  await transactionDone(metaTransaction);

  const transaction = database.transaction(['meta', 'stickers', 'assets'], 'readwrite');
  transaction.objectStore('meta').delete(ACTIVE_CHECKPOINT_KEY);
  if (meta) {
    const index = transaction.objectStore('stickers').index('runId');
    const request = index.openKeyCursor(IDBKeyRange.only(meta.id));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      transaction.objectStore('stickers').delete(cursor.primaryKey);
      cursor.continue();
    };
    const assetIndex = transaction.objectStore('assets').index('runId');
    const assetRequest = assetIndex.openKeyCursor(IDBKeyRange.only(meta.id));
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
