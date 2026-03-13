import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface DimensionData {
  id: number;
  value: number;
  variance: number;
  contribution: number;
  sparkline: number[];
}

const mockDimensions: DimensionData[] = [
  { id: 42, value: 0.847, variance: 0.234, contribution: 18.3, sparkline: [0.2, 0.5, 0.8, 0.6, 0.9, 0.7, 0.85, 0.83, 0.9, 0.85] },
  { id: 108, value: -0.623, variance: 0.189, contribution: 14.7, sparkline: [0.4, 0.6, 0.5, 0.7, 0.6, 0.5, 0.6, 0.65, 0.62, 0.63] },
  { id: 217, value: 0.512, variance: 0.156, contribution: 12.1, sparkline: [0.5, 0.4, 0.6, 0.5, 0.7, 0.6, 0.5, 0.52, 0.51, 0.51] },
  { id: 73, value: -0.489, variance: 0.142, contribution: 10.8, sparkline: [0.3, 0.5, 0.4, 0.6, 0.5, 0.4, 0.5, 0.49, 0.48, 0.49] },
  { id: 156, value: 0.401, variance: 0.128, contribution: 9.4, sparkline: [0.6, 0.5, 0.4, 0.5, 0.4, 0.3, 0.4, 0.42, 0.40, 0.40] },
  { id: 299, value: 0.378, variance: 0.119, contribution: 8.9, sparkline: [0.4, 0.3, 0.5, 0.4, 0.5, 0.4, 0.3, 0.38, 0.37, 0.38] },
  { id: 184, value: -0.334, variance: 0.103, contribution: 7.6, sparkline: [0.5, 0.4, 0.3, 0.4, 0.3, 0.5, 0.4, 0.35, 0.33, 0.33] },
  { id: 51, value: 0.289, variance: 0.091, contribution: 6.2, sparkline: [0.3, 0.4, 0.3, 0.2, 0.3, 0.4, 0.3, 0.30, 0.29, 0.29] }
];

export function DimensionAnalysis() {
  return (
    <div className="w-80 bg-[#020617] border-r border-[#333] flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div className="h-10 border-b border-[#333] bg-[#020617] flex items-center px-4 shrink-0">
        <div className="text-[#00FF41] font-mono text-xs uppercase tracking-wider font-bold">
          DIMENSION ANALYSIS
        </div>
      </div>

      {/* Dimension List */}
      <div className="flex-1 overflow-y-auto">
        {mockDimensions.map((dim, idx) => (
          <div
            key={dim.id}
            className="border-b border-[#333] p-4 hover:bg-[#00FF41]/5 transition-none"
          >
            {/* Dimension Header */}
            <div className="flex items-center justify-between mb-2">
              <div className="font-mono text-xs">
                <span className="text-gray-500">DIM_</span>
                <span className="text-[#00FF41]">{dim.id.toString().padStart(3, '0')}</span>
              </div>
              <div className="flex items-center gap-2">
                {dim.value > 0 ? (
                  <TrendingUp size={12} className="text-[#00FF41]" />
                ) : (
                  <TrendingDown size={12} className="text-gray-500" />
                )}
                <span className="font-mono text-xs text-white">
                  {dim.value.toFixed(3)}
                </span>
              </div>
            </div>

            {/* Sparkline */}
            <div className="h-12 mb-2 flex items-end gap-0.5">
              {dim.sparkline.map((val, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[#00FF41]"
                  style={{
                    height: `${val * 100}%`,
                    opacity: 0.3 + val * 0.5
                  }}
                />
              ))}
            </div>

            {/* Stats */}
            <div className="space-y-1 font-mono text-[10px]">
              <div className="flex justify-between">
                <span className="text-gray-500">VARIANCE</span>
                <span className="text-gray-300">{dim.variance.toFixed(3)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">CONTRIB</span>
                <span className="text-[#00FF41]">{dim.contribution.toFixed(1)}%</span>
              </div>
            </div>

            {/* Contribution bar */}
            <div className="mt-2 h-1 bg-[#111827] overflow-hidden">
              <div
                className="h-full bg-[#00FF41]"
                style={{ width: `${dim.contribution}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer Summary */}
      <div className="h-16 border-t border-[#333] bg-[#020617] p-4 shrink-0 font-mono text-[10px] space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-500">TOP 8 DIMS</span>
          <span className="text-[#00FF41]">88.0% VARIANCE</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">REMAINING</span>
          <span className="text-gray-400">376 DIMS (12.0%)</span>
        </div>
      </div>
    </div>
  );
}
