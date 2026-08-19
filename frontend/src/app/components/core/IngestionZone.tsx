import { useState, useCallback, useRef } from 'react';
import { Upload, CheckCircle, AlertTriangle, FileText } from 'lucide-react';
import { api } from '../../../api';

// Mirrors POST /api/documents + GET /api/documents/:id/status's real lifecycle, now
// routed through src/api/ (phase_1 §8) — api.documents.upload() + pollUntilSettled(),
// which is also what consolidates this poll loop with the one that used to live
// separately in EngineContext. No behavior change: same 1500ms interval, same 5-minute
// timeout. 'idle' is the only state with no in-flight document; everything else tracks a
// real Document row's status field one-to-one, so this label is never a fabricated stage
// the backend never reports.
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
      const data = await api.documents.upload(file);

      if (data.status === 'duplicate') {
        setResult({ fileName: data.fileName, chunkCount: 0, pageCount: 0, duplicate: true });
        setStage('ready');
        return;
      }

      const final = await api.documents.pollUntilSettled(data.documentId, (statusData) => {
        setProgress(statusData.progress ?? 0);
        if (statusData.status === 'queued' || statusData.status === 'processing') {
          setStage(statusData.status);
        }
      });

      if (final.status === 'failed') {
        throw new Error(final.error || 'Ingestion failed');
      }
      setResult({
        fileName: data.fileName, chunkCount: final.chunkCount,
        pageCount: final.pageCount, duplicate: false,
      });
      setStage('ready');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
      setStage('failed');
    }
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
        <Upload size={12} className="text-positive" />
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
          ${isDragging ? 'border-positive bg-positive/5 shadow-[inset_0_0_20px_rgba(0,255,65,0.1)]' : ''}
          ${isComplete ? 'border-positive/50 bg-positive/5' : ''}
          ${isError ? 'border-critical/50 bg-critical/5' : ''}
          ${!isDragging && !isComplete && !isError ? 'border-line hover:border-line-strong hover:bg-surface-sunken' : ''}
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
          <CheckCircle size={32} className="text-positive" />
        ) : isError ? (
          <AlertTriangle size={32} className="text-critical" />
        ) : (
          <FileText size={32} className={`${isActive ? 'text-positive animate-pulse' : 'text-gray-600'}`} />
        )}

        {/* Stage label */}
        <span className={`uppercase font-bold tracking-widest text-[10px] text-center px-2 ${
          isComplete ? 'text-positive' :
          isError ? 'text-critical' :
          isActive ? 'text-positive animate-pulse' : 'text-gray-500'
        }`}>
          {STAGE_LABELS[stage]}
        </span>

        {/* Real progress bar — driven by the Document row's own `progress` field
            (ingestion/ingestDocument.js's band boundaries), not a fake timeout sequence. */}
        {isActive && (
          <div className="w-3/4 h-1 bg-surface-sunken border border-line">
            <div className="h-full bg-positive transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {/* Result Summary */}
      {result && (
        <div className="border border-line bg-surface-sunken p-3 flex flex-col gap-1.5">
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
                <span className="text-positive font-bold">{result.chunkCount}</span>
              </div>
              {result.pageCount > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Pages</span>
                  <span className="text-positive font-bold">{result.pageCount}</span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="border border-critical/50 bg-critical/10 p-2 text-critical text-[10px] font-bold uppercase tracking-widest">
          {errorMsg}
        </div>
      )}

      {/* Reset */}
      {(isComplete || isError) && (
        <button
          onClick={() => { setStage('idle'); setResult(null); setErrorMsg(null); setProgress(0); }}
          className="border border-line bg-surface-sunken text-gray-500 uppercase font-bold tracking-widest text-[10px] py-2 hover:border-positive hover:text-positive transition-all"
        >
          INGEST ANOTHER FILE
        </button>
      )}
    </div>
  );
}
