import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import LegacyAutopilot from './AutopilotLegacy';
import { downloadMasterKit, reconcileMasterKit, type MasterKitReconciliation } from '../services/masterKit';
import { checkpointChangedEventName } from '../services/runPersistence';
import { syncGridPreviewsForChangedStickers } from '../services/gridSync';

interface AutopilotProps {
  initialNiche?: string | null;
}

const empty: MasterKitReconciliation = {
  runId: null,
  status: 'no_checkpoint',
  nextStage: null,
  summary: [],
  completedStickers: 0,
  targetStickers: 0,
  completedAssets: 0,
  volumeZipCount: 0
};

const Autopilot: FC<AutopilotProps> = props => {
  const [result, setResult] = useState<MasterKitReconciliation>(empty);
  const [checking, setChecking] = useState(false);
  const [gridNote, setGridNote] = useState('');
  const mounted = useRef(true);
  const running = useRef(false);
  const latestGridUrls = useRef(new Map<string, string>());

  const reconcile = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setChecking(true);
    try {
      const next = await reconcileMasterKit();
      if (mounted.current) setResult(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mounted.current) {
        setResult(previous => ({
          ...previous,
          status: 'error',
          nextStage: 'master_kit',
          error: message,
          summary: [...previous.summary, `finalization error: ${message}`]
        }));
      }
    } finally {
      running.current = false;
      if (mounted.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reconcile();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && result.status !== 'ready') void reconcile();
    }, 5000);
    const visible = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    document.addEventListener('visibilitychange', visible);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [reconcile, result.status]);

  useEffect(() => {
    const pendingStickerIds = new Set<number>();
    let debounceTimer: number | null = null;
    let syncing = false;

    const applyLatestGridsToLegacyView = () => {
      latestGridUrls.current.forEach((url, assetId) => {
        const match = assetId.match(/^preview_(\d+)$/);
        if (!match) return;
        const volume = Number(match[1]);
        const label = Array.from(document.querySelectorAll<HTMLElement>('[title]'))
          .find(element => element.title.includes(`Grid Preview (Vol ${volume})`));
        const card = label?.closest('.group') as HTMLElement | null;
        if (!card) return;
        const image = card.querySelector('img');
        if (image && image.getAttribute('src') !== url) image.setAttribute('src', url);
        const downloadButton = Array.from(card.querySelectorAll('button'))
          .find(button => button.textContent?.includes('Download JPG'));
        if (downloadButton) downloadButton.dataset.stickerosGridId = assetId;
      });
    };

    const runSync = async () => {
      if (syncing || !pendingStickerIds.size) return;
      syncing = true;
      const ids = [...pendingStickerIds];
      pendingStickerIds.clear();
      try {
        const syncResult = await syncGridPreviewsForChangedStickers(ids);
        syncResult.refreshed.forEach(asset => {
          if (asset.id && asset.url) latestGridUrls.current.set(asset.id, asset.url);
        });
        if (syncResult.refreshed.length && mounted.current) {
          const names = syncResult.refreshed.map(asset => asset.id?.replace('preview_', 'Grid ')).join(', ');
          setGridNote(`${names} updated locally; cover and paid mockups were not regenerated.`);
          applyLatestGridsToLegacyView();
        }
        if (syncResult.refreshed.length || syncResult.affectedVolumes.length) {
          await reconcile();
          window.setTimeout(() => void reconcile(), 1200);
        }
      } catch (error) {
        console.warn('Targeted grid refresh failed.', error);
        if (mounted.current) setGridNote('A grid refresh needs retry; no paid image asset was regenerated.');
      } finally {
        syncing = false;
        if (pendingStickerIds.size) {
          debounceTimer = window.setTimeout(() => void runSync(), 450);
        }
      }
    };

    const scheduleSync = (ids: number[]) => {
      ids.forEach(id => pendingStickerIds.add(id));
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void runSync(), 450);
    };

    const checkpointChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ stickerIds?: number[] }>).detail;
      scheduleSync(detail?.stickerIds || []);
    };

    const captureGridDownload = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest('button[data-stickeros-grid-id]') as HTMLButtonElement | null;
      if (!button) return;
      const assetId = button.dataset.stickerosGridId;
      const url = assetId ? latestGridUrls.current.get(assetId) : undefined;
      if (!assetId || !url) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${assetId}.jpg`;
      anchor.click();
    };

    window.addEventListener(checkpointChangedEventName, checkpointChanged);
    document.addEventListener('click', captureGridDownload, true);
    const domRefresh = window.setInterval(applyLatestGridsToLegacyView, 1200);
    return () => {
      window.removeEventListener(checkpointChangedEventName, checkpointChanged);
      document.removeEventListener('click', captureGridDownload, true);
      window.clearInterval(domRefresh);
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    };
  }, [reconcile]);

  const show = result.status !== 'no_checkpoint' || checking;
  const ready = result.status === 'ready' && result.masterKit;
  const label = ready
    ? 'MASTER KIT READY'
    : result.status === 'busy'
      ? 'FINALIZING IN ANOTHER TAB'
      : checking
        ? 'RECONCILING CHECKPOINT'
        : result.status === 'error'
          ? 'FINALIZATION NEEDS RETRY'
          : 'DURABLE FINALIZATION PENDING';

  return (
    <>
      {show && (
        <div className="max-w-7xl mx-auto px-6 pt-6">
          <div className={`rounded-xl border p-5 shadow-xl ${ready ? 'bg-emerald-950/40 border-emerald-500/50' : result.status === 'error' ? 'bg-red-950/35 border-red-500/50' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className={`text-sm font-black tracking-wider ${ready ? 'text-emerald-300' : result.status === 'error' ? 'text-red-300' : 'text-indigo-300'}`}>{label}</div>
                <div className="text-xs text-slate-400 mt-1">Resume-safe finalization verifies persisted files, rebuilds missing ZIPs locally, and never calls an image provider.</div>
                {gridNote && <div className="text-xs text-cyan-300 mt-2">{gridNote}</div>}
                {result.summary.length > 0 && (
                  <div className="mt-3 text-xs text-slate-300 space-y-1">
                    {result.summary.slice(-7).map((line, index) => <div key={`${line}-${index}`}>• {line}</div>)}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" onClick={() => void reconcile()} disabled={checking || result.status === 'busy'} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold disabled:opacity-50">
                  {checking ? 'Checking…' : ready ? 'Verify Again' : 'Retry Finalization'}
                </button>
                {ready && (
                  <button type="button" onClick={() => downloadMasterKit(result.masterKit!)} className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-sm font-black shadow-lg">
                    DOWNLOAD PERSISTED MASTER KIT
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <LegacyAutopilot {...props} />
    </>
  );
};

export default Autopilot;
