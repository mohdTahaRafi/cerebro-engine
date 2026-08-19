import { useState } from 'react';
import { Search, Download, Copy } from 'lucide-react';

// Generate a realistic 384-dimension vector
const generateVector = (seed: number = 0): number[] => {
  const vec: number[] = [];
  for (let i = 0; i < 384; i++) {
    vec.push((Math.sin(seed + i * 0.1) * 0.5 + Math.cos(seed + i * 0.07) * 0.3) * Math.random());
  }
  return vec;
};

const mockVector = generateVector(42);

export function VectorInspector() {
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightRange, setHighlightRange] = useState<[number, number] | null>(null);

  return (
    <div className="w-96 bg-surface border-l border-line flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-10 border-b border-line bg-surface flex items-center justify-between px-4 shrink-0">
        <div className="text-positive font-mono text-xs uppercase tracking-wider font-bold">
          VECTOR INSPECTOR
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-1 hover:bg-positive/10 border border-transparent hover:border-positive transition-none"
            title="Copy vector"
          >
            <Copy size={12} className="text-gray-500 hover:text-positive" />
          </button>
          <button
            className="p-1 hover:bg-positive/10 border border-transparent hover:border-positive transition-none"
            title="Export vector"
          >
            <Download size={12} className="text-gray-500 hover:text-positive" />
          </button>
        </div>
      </div>

      {/* Metadata Panel */}
      <div className="border-b border-line p-4 bg-surface shrink-0">
        <div className="space-y-2 font-mono text-[10px]">
          <div className="flex justify-between">
            <span className="text-gray-500">VECTOR_ID</span>
            <span className="text-positive">0xF8A2C4D1</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">DIMENSIONS</span>
            <span className="text-white">384</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">NORM (L2)</span>
            <span className="text-white">1.0000</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">SPARSITY</span>
            <span className="text-white">0.0%</span>
          </div>
        </div>
      </div>

      {/* Search/Filter */}
      <div className="border-b border-line p-3 bg-surface shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="FILTER BY INDEX OR VALUE..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-surface-raised border border-line pl-8 pr-3 py-1.5 font-mono text-[10px] text-gray-300 placeholder-gray-600 focus:border-positive focus:outline-none transition-none"
          />
        </div>
      </div>

      {/* Vector Array Display */}
      <div className="flex-1 overflow-y-auto bg-surface font-mono text-[10px]">
        <div className="p-3">
          <div className="text-gray-500 mb-2 text-[9px] uppercase tracking-wider">
            RAW FLOAT32 ARRAY [0-383]
          </div>

          <div className="space-y-px">
            {mockVector.map((value, idx) => {
              const isHighlighted =
                highlightRange &&
                idx >= highlightRange[0] &&
                idx <= highlightRange[1];

              const matchesSearch =
                searchTerm === '' ||
                idx.toString().includes(searchTerm) ||
                value.toFixed(6).includes(searchTerm);

              if (!matchesSearch) return null;

              return (
                <div
                  key={idx}
                  className={`flex items-center justify-between py-1 px-2 transition-none ${
                    isHighlighted
                      ? 'bg-positive/20 border-l-2 border-positive'
                      : 'hover:bg-surface-raised border-l-2 border-transparent'
                  }`}
                  onMouseEnter={() => setHighlightRange([Math.max(0, idx - 2), Math.min(383, idx + 2)])}
                  onMouseLeave={() => setHighlightRange(null)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-600 w-10 text-right">
                      [{idx.toString().padStart(3, '0')}]
                    </span>
                    <span className={`${
                      value > 0 ? 'text-positive' : 'text-gray-400'
                    }`}>
                      {value >= 0 ? ' ' : ''}{value.toFixed(6)}
                    </span>
                  </div>

                  {/* Mini bar chart */}
                  <div className="w-16 h-2 bg-surface-raised overflow-hidden">
                    <div
                      className={`h-full ${value > 0 ? 'bg-positive' : 'bg-gray-600'}`}
                      style={{
                        width: `${Math.abs(value) * 100}%`,
                        marginLeft: value < 0 ? `${100 - Math.abs(value) * 100}%` : '0'
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Statistics Footer */}
      <div className="h-20 border-t border-line bg-surface p-4 shrink-0 font-mono text-[10px] space-y-1.5">
        <div className="flex justify-between">
          <span className="text-gray-500">MIN VALUE</span>
          <span className="text-gray-300">{Math.min(...mockVector).toFixed(6)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">MAX VALUE</span>
          <span className="text-positive">{Math.max(...mockVector).toFixed(6)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">MEAN</span>
          <span className="text-gray-300">
            {(mockVector.reduce((a, b) => a + b, 0) / mockVector.length).toFixed(6)}
          </span>
        </div>
      </div>
    </div>
  );
}
