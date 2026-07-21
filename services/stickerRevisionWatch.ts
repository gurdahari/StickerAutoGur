const DATABASE_NAME = 'stickeros-production';
const DATABASE_VERSION = 2;
const ACTIVE_CHECKPOINT_KEY = 'active';

export interface StickerRevisionSnapshot {
  runId: string;
  revisions: Array<{
    id: number;
    fingerprint: string;
    savedAt: string;
    regenCount: number;
    replacementCount: number;
  }>;
}

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Sticker revision read failed.'));
  transaction.onabort = () => reject(transaction.error || new Error('Sticker revision read was aborted.'));
});

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Could not open the production checkpoint database.'));
});

/**
 * Reads only lightweight revision metadata from IndexedDB. It deliberately does
 * not create object URLs for the 100 PNG blobs, so it is safe to poll while the
 * completed production screen is open.
 */
export const loadStickerRevisionSnapshot = async (): Promise<StickerRevisionSnapshot | null> => {
  const database = await openDatabase();
  try {
    if (!database.objectStoreNames.contains('meta') || !database.objectStoreNames.contains('stickers')) return null;

    const metaTransaction = database.transaction('meta', 'readonly');
    const meta = await requestResult<{ id?: string } | undefined>(
      metaTransaction.objectStore('meta').get(ACTIVE_CHECKPOINT_KEY)
    );
    await transactionDone(metaTransaction);
    if (!meta?.id) return null;

    const stickerTransaction = database.transaction('stickers', 'readonly');
    const records = await requestResult<Array<{
      id: number;
      runId: string;
      contentFingerprint?: string;
      checkpointSavedAt?: string;
      regenCount?: number;
      replacementCount?: number;
      blob?: Blob;
    }>>(stickerTransaction.objectStore('stickers').index('runId').getAll(meta.id));
    await transactionDone(stickerTransaction);

    return {
      runId: meta.id,
      revisions: (records || [])
        .map(record => ({
          id: record.id,
          fingerprint: record.contentFingerprint || `legacy:${record.blob?.size || 0}`,
          savedAt: record.checkpointSavedAt || '',
          regenCount: record.regenCount || 0,
          replacementCount: record.replacementCount || 0
        }))
        .sort((left, right) => left.id - right.id)
    };
  } finally {
    database.close();
  }
};

export const stickerRevisionKey = (revision: StickerRevisionSnapshot['revisions'][number]) => [
  revision.fingerprint,
  revision.savedAt,
  revision.regenCount,
  revision.replacementCount
].join('|');
