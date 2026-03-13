import React from 'react';
import { Code2 } from 'lucide-react';

export function FormulaHUD() {
  return (
    <div className="h-24 border-t border-[#333] bg-[#020617] p-4 shrink-0">
      <div className="flex items-start gap-4 h-full">
        {/* Formula Section */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <Code2 size={14} className="text-[#00FF41]" />
            <span className="font-mono text-xs text-[#00FF41] uppercase tracking-wider">
              C++ CORE FORMULA
            </span>
          </div>

          <div className="font-mono text-xs text-gray-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-gray-500">SIMILARITY:</span>
              <code className="text-white bg-[#111827] px-2 py-0.5 border border-[#333]">
                cos(θ) = (A·B) / (||A|| * ||B||)
              </code>
            </div>
            <div className="text-[10px] text-gray-600">
              WHERE: A·B = Σ(a<sub>i</sub> × b<sub>i</sub>), ||A|| = √Σ(a<sub>i</sub>²), ||B|| = √Σ(b<sub>i</sub>²)
            </div>
          </div>
        </div>

        {/* Real-time computation stats */}
        <div className="w-64 border-l border-[#333] pl-4">
          <div className="font-mono text-[10px] space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-500">DOT PRODUCT OPS</span>
              <span className="text-[#00FF41]">147,456/sec</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">SIMD LANES</span>
              <span className="text-white">AVX-512 (16x)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">COMPUTE TIME</span>
              <span className="text-white">0.34 ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">CACHE HITS</span>
              <span className="text-[#00FF41]">98.7%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
