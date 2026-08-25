// phase_2 §4.2, §6 — the whole content area is a drop target (`noClick: true,
// noKeyboard: true`, matching the existing GlobalDropzone.tsx pattern on /chat), but only
// the margin's own box is clickable. The outer wrapper renders `display: contents` so it
// never affects ContextDetail's grid layout — it exists purely to own the drag listeners.
import type { ReactNode } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';

const ACCEPTED_LABEL = 'PDF, DOCX, TXT, MD, CSV, XLSX, XLS, JSON';

interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  children: (target: ReactNode) => ReactNode;
}

export function UploadDropzone({ onFiles, children }: UploadDropzoneProps) {
  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    noClick: true,
    noKeyboard: true,
    onDrop: onFiles,
  });

  const target = (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragActive ? 'border-signal bg-signal-soft' : 'border-line hover:border-line-strong hover:bg-surface-sunken'
        }`}
      >
        <UploadCloud className="size-6 text-signal" aria-hidden />
        <p className="text-sm font-medium text-ink">Drag and drop files here</p>
        <p className="text-xs text-graphite">or click to browse</p>
      </div>
      <div className="space-y-0.5 text-xs text-graphite">
        <p>Supported formats: {ACCEPTED_LABEL}</p>
        <p>Max file size: 50 MB</p>
      </div>
    </div>
  );

  return (
    <div {...getRootProps()} className="contents">
      <input {...getInputProps()} />
      {children(target)}
    </div>
  );
}
