import React from 'react';
import { useEngine } from '../context/EngineContext';
import { AnswerBox } from '../components/core/AnswerBox';
import { ChatInput } from '../components/ui/ChatInput';
import { SourceChip } from '../components/ui/SourceChip';
import { GlobalDropzone } from '../components/ui/GlobalDropzone';
import { motion, AnimatePresence } from 'motion/react';

export function ConsumerDashboard() {
  const { performSearch, isSearching, results, answer, isGenerating, chatError, askCerebro } = useEngine();

  const handleQuery = (query: string) => {
    performSearch(query);
    askCerebro(query);
  };

  const hasContent = answer || isGenerating || isSearching || (results && results.length > 0);

  return (
    <GlobalDropzone>
      <div className="flex-1 flex flex-col bg-[#050505] relative overflow-hidden h-full">
        
        {/* Dynamic Layout Wrapper */}
      <div className={`flex-1 flex flex-col w-full max-w-3xl mx-auto px-6 transition-all duration-700 ease-in-out ${hasContent ? 'pt-8 pb-40' : 'justify-center pb-20'}`}>
        
        {/* Header - Hides when content appears */}
        <AnimatePresence>
          {!hasContent && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, height: 0, margin: 0 }}
              className="flex flex-col items-center gap-4 mb-12"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-800 to-black border border-[#333] shadow-[0_0_40px_rgba(255,255,255,0.05)] flex items-center justify-center">
                <div className="w-4 h-4 bg-white rounded-sm animate-pulse"></div>
              </div>
              <h1 className="text-3xl font-semibold text-gray-200 tracking-tight">How can I help you?</h1>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Answer & Sources Area */}
        <AnimatePresence>
          {hasContent && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 w-full pr-4 pb-12"
            >
              {/* Generative Answer */}
              <AnswerBox answer={answer} isGenerating={isGenerating} error={chatError} />
              
              {/* Citations/Sources Container */}
              {results && results.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="mt-6 flex flex-col gap-3 pl-4 border-l-2 border-[#333]"
                >
                  <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold font-mono">Sources Analyzed</span>
                  <div className="flex flex-wrap gap-2">
                    {results.slice(0, 5).map((r, i) => (
                      <SourceChip 
                        key={r._id || r.documentId || i}
                        index={i}
                        documentId={r.documentId || r._id || ''}
                        fileName={r.metadata?.fileName || r.metadata?.source || 'Knowledge Node'}
                        position={r.metadata?.position}
                        textSnippet={r.textChunk || r.content || r.text}
                        score={r.rrfScore || r.similarity}
                      />
                    ))}
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input Bar (Locked to bottom if hasContent, centered if not) */}
        <div className={`w-full ${hasContent ? 'absolute bottom-8 left-0 right-0 px-6 max-w-3xl mx-auto' : ''}`}>
           <ChatInput onSearch={handleQuery} isSearching={isSearching || isGenerating} />
           <div className="text-center mt-3 text-[10px] text-gray-500 font-mono tracking-wide">
             Cerebro Engine operates entirely offline. No data leaves your machine.
           </div>
        </div>

      </div>
    </div>
    </GlobalDropzone>
  );
}
