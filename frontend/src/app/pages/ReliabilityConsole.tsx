import React from 'react';
import { CircuitBreakers } from '../components/reliability/CircuitBreakers';
import { PerformanceRace } from '../components/reliability/PerformanceRace';
import { CacheAndLogs } from '../components/reliability/CacheAndLogs';

export function ReliabilityConsole() {
  return (
    <div className="flex flex-1 overflow-hidden bg-[#020617] p-6 gap-6 font-mono">
      <CircuitBreakers />
      <PerformanceRace />
      <CacheAndLogs />
    </div>
  );
}