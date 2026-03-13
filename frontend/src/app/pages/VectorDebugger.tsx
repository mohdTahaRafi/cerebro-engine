import React, { useState, useEffect, useRef } from 'react';
import { VectorSpace3D } from '../components/vector/VectorSpace3D';
import { DimensionAnalysis } from '../components/vector/DimensionAnalysis';
import { VectorInspector } from '../components/vector/VectorInspector';
import { FormulaHUD } from '../components/vector/FormulaHUD';

export function VectorDebugger() {
  return (
    <div className="flex flex-1 overflow-hidden bg-[#020617]">
      {/* Left Panel: Dimension Analysis */}
      <DimensionAnalysis />

      {/* Center: 3D Vector Space */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <VectorSpace3D />
        <FormulaHUD />
      </div>

      {/* Right Panel: Vector Inspector */}
      <VectorInspector />
    </div>
  );
}
