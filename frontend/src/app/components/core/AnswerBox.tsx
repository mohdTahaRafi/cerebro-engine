import React from 'react';
import { motion } from 'motion/react';
import { Bot, Sparkles, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface AnswerBoxProps {
  answer: string;
  isGenerating: boolean;
  error: string | null;
}

export function AnswerBox({ answer, isGenerating, error }: AnswerBoxProps) {
  if (!answer && !isGenerating && !error) {
    return null; // Don't show if nothing to display
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="m-4 p-5 rounded-lg border border-[#333] bg-[#0A0A0A] shadow-lg relative overflow-hidden"
    >
      <div className="flex items-center gap-2 mb-3 border-b border-[#333] pb-2">
        <Bot className="w-5 h-5 text-[#00ff88]" />
        <h3 className="text-sm font-semibold text-[#00ff88] uppercase tracking-widest font-mono">
          Cerebro AI Synthesis
        </h3>
        {isGenerating && (
          <motion.div 
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
            className="ml-auto"
          >
            <Sparkles className="w-4 h-4 text-[#00ff88] opacity-70" />
          </motion.div>
        )}
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-red-400 font-mono text-sm">
          <AlertCircle className="w-4 h-4" />
          <p>{error}</p>
        </div>
      ) : (
        <div className="text-gray-200 font-sans leading-relaxed text-base prose prose-invert max-w-none">
          {answer ? (
             <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                  strong: ({node, ...props}) => <strong className="font-bold text-white" {...props} />,
                  code: ({node, ...props}) => <code className="bg-[#111] px-1.5 py-0.5 rounded border border-[#333] text-[#00FF41] font-mono text-sm" {...props} />
                }}
             >
               {answer + (isGenerating ? ' ▍' : '')}
             </ReactMarkdown>
          ) : (
             <span className="animate-pulse text-gray-500 font-mono">Analyzing knowledge base and synthesizing answer...</span>
          )}
        </div>
      )}

      {/* Decorative gradient line */}
      {isGenerating && (
         <motion.div 
            className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-transparent via-[#00ff88] to-transparent"
            initial={{ width: "0%", x: "0%" }}
            animate={{ width: ["0%", "50%", "0%"], x: ["0%", "100%", "200%"] }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
         />
      )}
    </motion.div>
  );
}
