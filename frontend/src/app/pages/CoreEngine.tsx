import React from 'react';
import { QueryConsole } from '../components/core/QueryConsole';
import { ExecutionPlan } from '../components/core/ExecutionPlan';
import { HardwareStats } from '../components/core/HardwareStats';
import { ResultsTable } from '../components/core/ResultsTable';

export function CoreEngine() {
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar: Query Console */}
      <QueryConsole />

      {/* Center Pane: Execution Plan (Top) & Results Table (Bottom) */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">
        <ExecutionPlan />
        <ResultsTable />
      </div>

      {/* Right Sidebar: Hardware & Caching Stats */}
      <HardwareStats />
    </div>
  );
}