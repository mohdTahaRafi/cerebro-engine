import { useState, useCallback, useRef } from 'react';
import { Upload, CheckCircle, AlertTriangle, FileText } from 'lucide-react';

type IngestionStage = 
  | 'idle' 
  | 'chunking' 
  | 'vectorizing' 
  | 'syncing' 
  | 'complete' 
  | 'error';

interface IngestionResult {
  fileName: string;
  skipped: boolean;
  chunksCreated: number;
  processingTimeMs: number;
  message: string;
}

const STAGE_LABELS: Record<IngestionStage, string> = {
  idle: 'DROP .TXT FILE TO INGEST',
  chunking: 'Chunking document...',
  vectorizing: 'Vectorizing...',
  syncing: 'Syncing to Atlas...',
  complete: 'INGESTION COMPLETE',
  error: 'INGESTION FAILED'
};

export function IngestionZone() {
  const [stage, setStage] = useState<IngestionStage>('idle');
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingest = useCallback(async (file: File) => {
    setResult(null);
    setErrorMsg(null);

    // Simulate real-time progress states
    setStage('chunking');
    await new Promise(r => setTimeout(r, 600));
    setStage('vectorizing');
    await new Promise(r => setTimeout(r, 400));
    setStage('syncing');

    try {
      const formData = new FormData();
      formData.append('document', file);

      const response = await fetch('/api/ingest', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ingestion failed');
      }

      setResult(data);
      setStage('complete');
    } catch (err: any) {
      setErrorMsg(err.message);
      setStage('error');
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

  const isActive = stage !== 'idle' && stage !== 'complete' && stage !== 'error';
  const isComplete = stage === 'complete';
  const isError = stage === 'error';

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
          accept=".txt,.pdf"
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

        {/* Active timeline indicator */}
        {isActive && (
          <div className="flex gap-1.5 items-center">
            {(['chunking', 'vectorizing', 'syncing'] as IngestionStage[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${
                  s === stage ? 'bg-[#00FF41] scale-125' : 
                  (['chunking', 'vectorizing', 'syncing'].indexOf(s) < ['chunking', 'vectorizing', 'syncing'].indexOf(stage))
                    ? 'bg-[#00FF41]/50' : 'bg-gray-700'
                }`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Result Summary */}
      {result && (
        <div className="border border-[#333] bg-black p-3 flex flex-col gap-1.5">
          <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] mb-1">Ingestion Summary</div>
          <div className="flex justify-between">
            <span className="text-gray-400">File</span>
            <span className="text-white truncate max-w-[140px]">{result.fileName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Chunks Created</span>
            <span className="text-[#00FF41] font-bold">{result.chunksCreated}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Processing Time</span>
            <span className="text-[#00FF41] font-bold">{result.processingTimeMs}ms</span>
          </div>
          {result.skipped && (
            <div className="text-yellow-500 text-[10px] mt-1 uppercase font-bold tracking-wider">⚠ Skipped (already exists)</div>
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
          onClick={() => { setStage('idle'); setResult(null); setErrorMsg(null); }}
          className="border border-[#333] bg-black text-gray-500 uppercase font-bold tracking-widest text-[10px] py-2 hover:border-[#00FF41] hover:text-[#00FF41] transition-all"
        >
          INGEST ANOTHER FILE
        </button>
      )}
    </div>
  );
}
