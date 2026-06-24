import React from 'react';
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
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#111] hover:bg-[#222] border border-[#333] rounded-full cursor-pointer transition-colors text-xs font-mono text-gray-400 select-none"
        >
          <FileText size={12} className="text-gray-500" />
          <span className="truncate max-w-[150px]">{displayTitle}</span>
        </motion.div>
      </HoverCard.Trigger>
      
      <HoverCard.Portal>
        <HoverCard.Content 
          sideOffset={5} 
          className="z-50 w-80 bg-[#0F0F0F] border border-[#333] shadow-xl p-4 font-mono text-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
        >
          <div className="flex justify-between items-center mb-2 border-b border-[#222] pb-2">
             <span className="font-bold text-gray-300 truncate">{displayTitle}</span>
             {score !== undefined && (
               <span className="text-[10px] text-[#00FF41] bg-[#00FF41]/10 px-1.5 py-0.5 border border-[#00FF41]/20">
                 {score.toFixed(4)}
               </span>
             )}
          </div>
          <p className="text-gray-400 text-xs leading-relaxed max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap">
            {textSnippet || 'No text snippet available.'}
          </p>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
