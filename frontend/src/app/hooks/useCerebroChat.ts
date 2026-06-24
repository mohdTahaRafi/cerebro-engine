import { useState } from 'react';

export function useCerebroChat() {
  const [answer, setAnswer] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askCerebro = async (query: string) => {
    if (!query.trim()) return;
    
    setIsGenerating(true);
    setAnswer('');
    setError(null);
    console.log(`FRONTEND: Initiating Generation for [${query}]...`);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        throw new Error('Failed to start generation stream');
      }

      if (!response.body) {
        throw new Error('No readable stream available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      
      let done = false;
      let buffer = '';
      
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          
          let doubleNewlineIndex = buffer.indexOf('\n\n');
          while (doubleNewlineIndex !== -1) {
            const line = buffer.substring(0, doubleNewlineIndex).trim();
            buffer = buffer.substring(doubleNewlineIndex + 2);
            
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              
              if (dataStr === '[DONE]') {
                done = true;
                break;
              }
              
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.error) {
                  setError(parsed.error);
                  break;
                }
                if (parsed.token) {
                  setAnswer((prev) => prev + parsed.token);
                }
              } catch (e) {
                console.error("Failed to parse SSE JSON:", e);
              }
            }
            doubleNewlineIndex = buffer.indexOf('\n\n');
          }
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    answer,
    isGenerating,
    error,
    askCerebro
  };
}
