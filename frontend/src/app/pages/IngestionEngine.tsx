import React from 'react';
import { CentralPipeline } from '../components/ingestion/CentralPipeline';
import { ThroughputTelemetry } from '../components/ingestion/ThroughputTelemetry';
import { SystemLogs } from '../components/ingestion/SystemLogs';

export function IngestionEngine() {
  return (
    <div className="flex flex-1 overflow-hidden bg-[#020617] font-mono">
      
      {/* Center Pane: Visual Pipeline (Top) & Telemetry (Bottom) */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <CentralPipeline />
        <ThroughputTelemetry />
      </div>

      {/* Right Sidebar: System Logs */}
      <div className="w-[400px] shrink-0 border-l border-[#333] bg-[#020617] flex flex-col">
        <SystemLogs />
      </div>

    </div>
  );
}