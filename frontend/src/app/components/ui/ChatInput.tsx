import React, { useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { ArrowUp, Paperclip, X } from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { useEngine } from '../../context/EngineContext';

interface ChatInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
}

export function ChatInput({ onSearch, isSearching }: ChatInputProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { attachedFiles, setAttachedFiles, attachedSources, setAttachedSources, ingestFile } = useEngine();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    
    // Clear input so the same file can be uploaded again if needed
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.currentTarget.value.trim() && !isSearching) {
        formRef.current?.requestSubmit();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const query = formData.get('query') as string;

    if (query.trim() && !isSearching) {
      onSearch(query.trim());
      // Attachments are ingested (and already persisted to the knowledge base)
      // the moment they're attached, not held until send — so once the query
      // is sent there's nothing left pending on either the text or the chips.
      e.currentTarget.reset();
      setAttachedFiles([]);
      setAttachedSources([]);
    }
  };

  return (
    <motion.form 
      ref={formRef}
      onSubmit={handleSubmit}
      layoutId="chat-input-form"
      className="relative flex flex-col w-full shadow-[0_0_30px_rgba(0,0,0,0.5)] rounded-2xl bg-[#0F0F0F] border border-[#333] transition-all focus-within:border-[#555] focus-within:shadow-[0_0_40px_rgba(255,255,255,0.05)] p-3 pb-2"
    >
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        className="hidden" 
        accept=".txt,.md,.json,.pdf,.csv,.xlsx,.docx" 
      />
      
      {/* Attachments Area */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 px-2">
          {attachedFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-2 bg-[#222] border border-[#444] rounded-xl px-3 py-1.5">
              <span className="text-xs font-mono text-gray-300 truncate max-w-[150px]">{file.name}</span>
              <button
                type="button"
                onClick={() => {
                  setAttachedFiles(prev => prev.filter((_, idx) => idx !== i));
                  setAttachedSources(prev => prev.filter((_, idx) => idx !== i));
                }}
                className="text-gray-500 hover:text-white transition-colors"
                title="Remove attachment"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="relative flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl text-gray-400 hover:text-white hover:bg-[#222] transition-colors mb-1"
          title="Attach Document"
        >
          <Paperclip size={20} />
        </button>

        <TextareaAutosize
          name="query"
          placeholder="Ask Cerebro anything..."
          className="flex-1 bg-transparent text-gray-200 placeholder-gray-500 text-lg py-2 resize-none focus:outline-none custom-scrollbar leading-relaxed"
          minRows={1}
          maxRows={6}
          onKeyDown={handleKeyDown}
          disabled={isSearching}
        />
        
        <button
          type="submit"
          disabled={isSearching}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-xl bg-white text-black hover:bg-gray-200 disabled:opacity-30 disabled:bg-gray-700 disabled:text-gray-400 transition-colors mb-1"
        >
          <ArrowUp size={20} strokeWidth={3} />
        </button>
      </div>
    </motion.form>
  );
}
