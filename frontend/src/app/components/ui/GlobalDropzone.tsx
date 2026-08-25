// phase_3_chat_ui.md §7.1 — files dropped anywhere on the page upload into the active
// context. Rewritten for Phase 3: previously called EngineContext's context-less v1
// ingestFile for a single file; now a thin, stateless wrapper that hands accepted files to
// whatever queue the caller owns (Chat.tsx's useUploadQueue instance, shared with the
// Composer's own attach button so both paths produce the same chips).
import { useCallback, type ReactNode } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';

interface GlobalDropzoneProps {
  onDrop: (files: File[]) => void;
  disabled?: boolean;
  children: ReactNode;
}

export function GlobalDropzone({ onDrop, disabled = false, children }: GlobalDropzoneProps) {
  const handleDrop = useCallback((files: File[]) => {
    if (!disabled && files.length > 0) onDrop(files);
  }, [onDrop, disabled]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    noClick: true,
    noKeyboard: true,
    disabled,
  });

  return (
    <div {...getRootProps()} className="flex-1 w-full h-full relative outline-none flex flex-col overflow-hidden">
      <input {...getInputProps()} />
      {children}

      {isDragActive && !disabled && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center border-4 border-dashed border-signal bg-signal-soft backdrop-blur-sm pointer-events-none transition-all">
          <UploadCloud size={64} className="mb-4 text-signal animate-bounce" />
          <h2 className="text-2xl font-bold text-ink">Drop to ingest</h2>
          <p className="mt-2 text-sm text-signal">The file will be embedded and added to this context</p>
        </div>
      )}
    </div>
  );
}
