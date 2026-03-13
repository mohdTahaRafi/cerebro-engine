import React from 'react';
import { ResultCard, ResultCardProps } from './ResultCard';

const mockResults: ResultCardProps[] = [
  {
    score: 98,
    matchType: 'Vector',
    title: 'Neural Architecture Search for High-Dimensional Vectors',
    summary: 'Explores semantic embedding techniques for fast vector retrieval using HNSW indexing and quantization methods.',
    source: 'AWS S3',
    format: 'PDF'
  },
  {
    score: 94,
    matchType: 'Vector',
    title: 'Optimizing Redis Cache for Machine Learning Pipelines',
    summary: 'A comprehensive guide on leveraging Redis modules to reduce latency in real-time ML inference workloads.',
    source: 'PostgreSQL',
    format: 'Markdown'
  },
  {
    score: 87,
    matchType: 'Keyword',
    title: 'Understanding C++ Core Guidelines for Performance',
    summary: 'Detailed analysis of modern C++ memory management techniques and their impact on execution latency.',
    source: 'Confluence',
    format: 'HTML'
  },
  {
    score: 82,
    matchType: 'Vector',
    title: 'Semantic Search Intent Classification Models',
    summary: 'Research paper detailing the use of transformer architectures to classify user search intent in domain-specific contexts.',
    source: 'AWS S3',
    format: 'PDF'
  },
  {
    score: 75,
    matchType: 'Keyword',
    title: 'API Gateway Rate Limiting Strategies',
    summary: 'Documentation on configuring rate limits and throttling rules to protect backend services from traffic spikes.',
    source: 'GitHub',
    format: 'TXT'
  },
  {
    score: 71,
    matchType: 'Vector',
    title: 'Distributed Tracing in Microservices Architectures',
    summary: 'Best practices for implementing distributed tracing to monitor latency bottlenecks across complex systems.',
    source: 'Google Drive',
    format: 'Docx'
  }
];

export function ResultsGrid() {
  return (
    <div className="w-full max-w-7xl mx-auto mt-12 px-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-slate-100 tracking-tight flex items-center gap-2">
          Top Results
          <span className="text-xs bg-slate-800 text-slate-400 py-0.5 px-2 rounded-full font-mono font-medium">6 matches</span>
        </h2>
        <div className="flex gap-2">
          {/* Filter placeholders */}
          <button className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-lg hover:bg-slate-700 transition-colors border border-slate-700">All Sources</button>
          <button className="px-3 py-1.5 bg-slate-800 text-slate-300 text-xs font-medium rounded-lg hover:bg-slate-700 transition-colors border border-slate-700">Sort: Relevance</button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {mockResults.map((result, idx) => (
          <ResultCard key={idx} {...result} />
        ))}
      </div>
    </div>
  );
}