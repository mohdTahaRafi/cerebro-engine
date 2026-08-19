import { motion } from 'motion/react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { FileText } from 'lucide-react';

interface SourceChipProps {
  documentId: string;
  fileName?: string;
  position?: string;
  textSnippet?: string;
  score?: number;
  index: number;
}

export function SourceChip({ fileName, position, textSnippet, score, index }: SourceChipProps) {
  // Extract basename from potential path like "uploads/..."
  const cleanName = fileName ? fileName.split('/').pop() : 'Knowledge Node';
  const displayTitle = position ? `${cleanName} (${position})` : cleanName;
  return (
    <HoverCard.Root openDelay={200} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="inline-flex select-none items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-raised cursor-pointer"
        >
          <FileText size={12} className="text-graphite" aria-hidden="true" />
          <span className="max-w-[150px] truncate">{displayTitle}</span>
        </motion.div>
      </HoverCard.Trigger>

      <HoverCard.Portal>
        <HoverCard.Content
          sideOffset={5}
          className="z-50 w-80 rounded-lg border border-line bg-surface-overlay p-4 text-sm shadow-3 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
             <span className="truncate font-medium text-ink">{displayTitle}</span>
             {score !== undefined && (
               <span className="rounded-sm border border-signal-soft-line bg-signal-soft px-1.5 py-0.5 text-[10px] text-signal">
                 {score.toFixed(4)}
               </span>
             )}
          </div>
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-secondary custom-scrollbar">
            {textSnippet || 'No text snippet available.'}
          </p>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
