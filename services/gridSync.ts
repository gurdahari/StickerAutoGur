import type { MarketingAsset, Sticker } from '../types';
import { createTargetedGridPreview } from './gridPreview';
import { loadRunCheckpoint, saveMarketingAssetCheckpoint } from './runPersistence';

export type GridAssetRevision = MarketingAsset & {
  sourceStickerIds?: number[];
  sourceSignature?: string;
};

export interface GridSyncResult {
  runId: string | null;
  refreshed: GridAssetRevision[];
  affectedVolumes: number[];
}

const FINALIZATION_DB = 'stickeros-finalization';
const FINALIZATION_VERSION = 1;
const GRID_SIZE = 17;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error);
  transaction.onabort = () => reject(transaction.error);
});

const openFinalizationDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(FINALIZATION_DB, FINALIZATION_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains('kits')) {
      const store = database.createObjectStore('kits', { keyPath: 'id' });
      store.createIndex('runId', 'runId', { unique: false });
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const invalidateLocalPackages = async (runId: string, stickerIds: number[]) => {
  try {
    const database = await openFinalizationDatabase();
    if (!database.objectStoreNames.contains('kits')) {
      database.close();
      return;
    }
    const readTransaction = database.transaction('kits', 'readonly');
    const rows = await requestResult<Array<{ id: string; runId: string; kind: 'volume' | 'master' }>>(readTransaction.objectStore('kits').index('runId').getAll(runId));
    await transactionDone(readTransaction);
    const affectedVolumes = new Set(stickerIds.map(id => Math.floor(Math.max(0, id - 1) / 20) + 1));
    const idsToDelete = rows
      .filter(row => {
        if (row.kind === 'master') return true;
        const match = row.id.match(/:volume:(\d+)$/);
        return row.kind === 'volume' && Boolean(match && affectedVolumes.has(Number(match[1])));
      })
      .map(row => row.id);
    if (idsToDelete.length) {
      const writeTransaction = database.transaction('kits', 'readwrite');
      const store = writeTransaction.objectStore('kits');
      idsToDelete.forEach(id => store.delete(id));
      await transactionDone(writeTransaction);
    }
    database.close();
  } catch (error) {
    console.warn('Could not invalidate local ZIP/Master Kit cache after a sticker change.', error);
  }
};

const stickerPixelSignature = (sticker: Sticker & { contentFingerprint?: string }) =>
  `${sticker.id}:${sticker.contentFingerprint || sticker.blob?.size || 0}`;

const releaseCheckpointUrls = (stickers: Sticker[], assets: MarketingAsset[]) => {
  stickers.forEach(sticker => {
    if (sticker.url?.startsWith('blob:')) URL.revokeObjectURL(sticker.url);
  });
  assets.forEach(asset => {
    if (asset.url?.startsWith('blob:')) URL.revokeObjectURL(asset.url);
  });
};

/**
 * Rebuilds only preview_N images whose sticker range intersects the changed
 * sticker IDs. Grid rendering and package invalidation are browser-local and
 * never call OpenAI or Seedream.
 */
export const syncGridPreviewsForChangedStickers = async (stickerIds: number[]): Promise<GridSyncResult> => {
  const uniqueIds = [...new Set(stickerIds.filter(id => Number.isFinite(id) && id > 0))].sort((a, b) => a - b);
  if (!uniqueIds.length) return { runId: null, refreshed: [], affectedVolumes: [] };
  const checkpoint = await loadRunCheckpoint();
  if (!checkpoint) return { runId: null, refreshed: [], affectedVolumes: [] };

  const previewByPage = new Map<number, GridAssetRevision>();
  checkpoint.marketingAssets.forEach(asset => {
    const match = asset.id?.match(/^preview_(\d+)$/);
    if (match) previewByPage.set(Math.max(0, Number(match[1]) - 1), asset as GridAssetRevision);
  });
  if (!previewByPage.size) {
    releaseCheckpointUrls(checkpoint.stickers, checkpoint.marketingAssets);
    return { runId: checkpoint.meta.id, refreshed: [], affectedVolumes: [] };
  }

  const affectedVolumes = [...new Set(uniqueIds.map(id => Math.floor((id - 1) / 20) + 1))];
  await invalidateLocalPackages(checkpoint.meta.id, uniqueIds);

  const allSlots = [...checkpoint.stickers]
    .sort((left, right) => left.id - right.id)
    .slice(0, checkpoint.meta.targetCount);
  const affectedPages = new Set<number>();
  uniqueIds.forEach(id => {
    const index = allSlots.findIndex(sticker => sticker.id === id);
    if (index >= 0) affectedPages.add(Math.floor(index / GRID_SIZE));
  });

  const refreshed: GridAssetRevision[] = [];
  try {
    for (const page of [...affectedPages].sort((a, b) => a - b)) {
      const existing = previewByPage.get(page);
      if (!existing?.id) continue;
      const pageStickers = allSlots
        .slice(page * GRID_SIZE, Math.min(allSlots.length, page * GRID_SIZE + GRID_SIZE))
        .filter(sticker => sticker.status === 'completed' && sticker.blob?.size && sticker.url && sticker.qaStatus !== 'rejected');
      if (!pageStickers.length) continue;
      const sourceStickerIds = pageStickers.map(sticker => sticker.id);
      const sourceSignature = pageStickers.map(sticker => stickerPixelSignature(sticker)).join('|');
      if (existing.sourceSignature === sourceSignature) continue;
      const url = await createTargetedGridPreview(pageStickers);
      const completed: GridAssetRevision = {
        ...existing,
        url,
        status: 'completed',
        sourceStickerIds,
        sourceSignature
      };
      await saveMarketingAssetCheckpoint(checkpoint.meta.id, completed);
      refreshed.push(completed);
    }
    return { runId: checkpoint.meta.id, refreshed, affectedVolumes };
  } finally {
    releaseCheckpointUrls(checkpoint.stickers, checkpoint.marketingAssets);
  }
};
