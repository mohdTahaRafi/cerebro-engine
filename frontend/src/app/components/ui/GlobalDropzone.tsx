import React, { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { UploadCloud } from 'lucide-react';
import { toast } from 'sonner';
import { useEngine } from '../../context/EngineContext';

export function GlobalDropzone({ children }: { children: React.ReactNode }) {
  const { ingestFile } = useEngine();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    const file = acceptedFiles[0];

    const toastId = toast.loading(`Ingesting ${file.name}...`, {
      description: 'Parsing, chunking, and embedding the document — this can take a while for large or scanned files.'
    });

    try {
      const data = await ingestFile(file, (status) => {
        toast.loading(`Ingesting ${file.name}... (${status.progress}%)`, {
          id: toastId,
          description: `Status: ${status.status}`,
        });
      });

      toast.success(
        data.status === 'duplicate' ? `${file.name} was already ingested` : `Successfully ingested ${file.name}`,
        {
          id: toastId,
          description: data.status === 'duplicate'
            ? 'Identical content already exists in the knowledge base — reusing it.'
            : `Added ${data.chunkCount} chunk(s)${data.pageCount ? ` across ${data.pageCount} page(s)` : ''} to the knowledge base.`,
        },
      );
    } catch (err) {
      toast.error(`Failed to ingest ${file.name}`, {
        id: toastId,
        description: (err as Error).message
      });
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: true,
    noKeyboard: true
  });

  return (
    <div {...getRootProps()} className="flex-1 w-full h-full relative outline-none flex flex-col overflow-hidden">
      <input {...getInputProps()} />
      {children}
      
      {isDragActive && (
        <div className="absolute inset-0 z-50 bg-[#00FF41]/10 backdrop-blur-sm border-4 border-dashed border-[#00FF41] flex flex-col items-center justify-center pointer-events-none transition-all">
           <UploadCloud size={64} className="text-[#00FF41] mb-4 animate-bounce" />
           <h2 className="text-3xl font-bold text-white tracking-widest uppercase shadow-black drop-shadow-md">Drop to Ingest</h2>
           <p className="text-[#00FF41] font-mono mt-2 shadow-black drop-shadow-md">File will be embedded and added to Cerebro</p>
        </div>
      )}
    </div>
  );
}
