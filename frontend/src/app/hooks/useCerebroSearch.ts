import { useState } from 'react';

interface Telemetry {
  cacheWaitMs: number;
  embeddingMs: number;
  retrievalMs: number;
  rerankingMs: number;
  rerankingUs: number; // High-resolution microsecond C++ timing
  totalMs: number;
}

interface SearchResult {
  documentId: string;
  content: string;
  fileName?: string;
  textChunk?: string;
  similarity: number;
}

interface SearchResponse {
  results: SearchResult[];
  telemetry: Telemetry;
}

export function useCerebroSearch() {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  // Custom states for safety fallbacks
  const [error, setError] = useState<string | null>(null);
  const [isCircuitOpen, setIsCircuitOpen] = useState(false);

  const performSearch = async (query: string) => {
    if (!query.trim()) return;
    
    setIsSearching(true);
    setError(null);
    setIsCircuitOpen(false);
    console.log(`FRONTEND: Initiating Search for [${query}]...`);

    try {
      // Use Vite proxy — routes /api -> localhost:5000
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      const data = await response.json();

      // Catch the Circuit Breaker Opossum fallback HTTP 503
      if (response.status === 503 && data.status === 'Circuit Open') {
        setIsCircuitOpen(true);
        setError(data.error);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to execute search');
      }

      setResults(data.results);
      setTelemetry(data.telemetry);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSearching(false);
    }
  };

  return {
    results,
    telemetry,
    isSearching,
    error,
    isCircuitOpen,
    performSearch
  };
}
