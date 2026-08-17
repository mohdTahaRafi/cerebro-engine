import { useState, useCallback, useRef } from 'react';
import { Upload, CheckCircle, AlertTriangle, FileText } from 'lucide-react';

// Mirrors POST /api/documents + GET /api/documents/:id/status's real lifecycle (phase 6
// §5.1: the legacy /api/ingest this used to hit no longer exists). 'idle' is the only
// state with no in-flight document; everything else tracks a real Document row's status
// field one-to-one, so this label is never a fabricated stage the backend never reports.
type IngestionStage = 'idle' | 'queued' | 'processing' | 'ready' | 'failed';

interface IngestionResult {
  fileName: string;
  chunkCount: number;
  pageCount: number;
  duplicate: boolean;
}

const STAGE_LABELS: Record<IngestionStage, string> = {
  idle: 'DROP DOCUMENT TO INGEST',
  queued: 'Queued — waiting for a worker...',
  processing: 'Parsing, chunking & embedding...',
  ready: 'INGESTION COMPLETE',
  failed: 'INGESTION FAILED',
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60_000;

export function IngestionZone() {
  const [stage, setStage] = useState<IngestionStage>('idle');
  const [progress, setProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (file: File) => {
    setResult(null);
    setErrorMsg(null);
    setProgress(0);
    setStage('queued');

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/documents', { method: 'POST', body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Upload failed');

      if (data.status === 'duplicate') {
        setResult({ fileName: data.fileName, chunkCount: 0, pageCount: 0, duplicate: true });
        setStage('ready');
        return;
      }

      const deadline = Date.now() + POLL_TIMEOUT_MS;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) throw new Error('Ingestion is taking longer than expected.');
        const statusRes = await fetch(`/api/documents/${data.documentId}/status`);
        const statusData = await statusRes.json();
        setProgress(statusData.progress ?? 0);
        setStage(statusData.status === 'queued' || statusData.status === 'processing' ? statusData.status : stage);

        if (statusData.status === 'ready') {
          setResult({
            fileName: data.fileName, chunkCount: statusData.chunkCount,
            pageCount: statusData.pageCount, duplicate: false,
          });
          setStage('ready');
          return;
        }
        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Ingestion failed');
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } catch (err: any) {
      setErrorMsg(err.message);
      setStage('failed');
    }
    // stage is read but deliberately not a dependency — this loop drives its own
    // transitions from the polled response, not from re-running on stage changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) ingest(file);
  }, [ingest]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) ingest(file);
  }, [ingest]);

  const isActive = stage === 'queued' || stage === 'processing';
  const isComplete = stage === 'ready';
  const isError = stage === 'failed';

  return (
    <div className="flex flex-col gap-3 h-full font-mono text-xs">
      {/* Header */}
      <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] flex items-center gap-2">
        <Upload size={12} className="text-[#00FF41]" />
        Document Ingestion
      </div>

      {/* Drop Zone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={`
          relative flex-1 min-h-[180px] border-2 border-dashed flex flex-col items-center justify-center gap-4 cursor-pointer transition-all duration-300
          ${isDragging ? 'border-[#00FF41] bg-[#00FF41]/5 shadow-[inset_0_0_20px_rgba(0,255,65,0.1)]' : ''}
          ${isComplete ? 'border-[#00FF41]/50 bg-[#00FF41]/5' : ''}
          ${isError ? 'border-[#FF003C]/50 bg-[#FF003C]/5' : ''}
          ${!isDragging && !isComplete && !isError ? 'border-[#333] hover:border-[#555] hover:bg-[#111]' : ''}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.json"
          className="hidden"
          onChange={onFileChange}
        />

        {/* Icon */}
        {isComplete ? (
          <CheckCircle size={32} className="text-[#00FF41]" />
        ) : isError ? (
          <AlertTriangle size={32} className="text-[#FF003C]" />
        ) : (
          <FileText size={32} className={`${isActive ? 'text-[#00FF41] animate-pulse' : 'text-gray-600'}`} />
        )}

        {/* Stage label */}
        <span className={`uppercase font-bold tracking-widest text-[10px] text-center px-2 ${
          isComplete ? 'text-[#00FF41]' :
          isError ? 'text-[#FF003C]' :
          isActive ? 'text-[#00FF41] animate-pulse' : 'text-gray-500'
        }`}>
          {STAGE_LABELS[stage]}
        </span>

        {/* Real progress bar — driven by the Document row's own `progress` field
            (ingestion/ingestDocument.js's band boundaries), not a fake timeout sequence. */}
        {isActive && (
          <div className="w-3/4 h-1 bg-[#111] border border-[#333]">
            <div className="h-full bg-[#00FF41] transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {/* Result Summary */}
      {result && (
        <div className="border border-[#333] bg-black p-3 flex flex-col gap-1.5">
          <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] mb-1">Ingestion Summary</div>
          <div className="flex justify-between">
            <span className="text-gray-400">Source</span>
            <span className="text-white truncate max-w-[140px]">{result.fileName}</span>
          </div>
          {result.duplicate ? (
            <div className="text-yellow-500 text-[10px] mt-1 uppercase font-bold tracking-wider">
              ⚠ Identical content already ingested — reused existing document
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-gray-400">Chunks Created</span>
                <span className="text-[#00FF41] font-bold">{result.chunkCount}</span>
              </div>
              {result.pageCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Pages</span>
                  <span className="text-[#00FF41] font-bold">{result.pageCount}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="border border-[#FF003C]/50 bg-[#FF003C]/10 p-2 text-[#FF003C] text-[10px] font-bold uppercase tracking-widest">
          {errorMsg}
        </div>
      )}

      {/* Reset */}
      {(isComplete || isError) && (
        <button
          onClick={() => { setStage('idle'); setResult(null); setErrorMsg(null); setProgress(0); }}
          className="border border-[#333] bg-black text-gray-500 uppercase font-bold tracking-widest text-[10px] py-2 hover:border-[#00FF41] hover:text-[#00FF41] transition-all"
        >
          INGEST ANOTHER FILE
        </button>
      )}
    </div>
  );
}
