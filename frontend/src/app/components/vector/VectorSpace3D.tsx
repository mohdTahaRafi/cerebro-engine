import React, { useRef, useEffect, useState } from 'react';
import { Target, ZoomIn, ZoomOut } from 'lucide-react';

interface DataPoint {
  x: number;
  y: number;
  z: number;
  id: number;
  isResult?: boolean;
  distance?: number;
}

export function VectorSpace3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rotation, setRotation] = useState({ x: 0.3, y: 0.5 });
  const [isDragging, setIsDragging] = useState(false);
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 });
  const [queryActive, setQueryActive] = useState(true);
  const animationRef = useRef<number>();

  // Generate thousands of data points
  const dataPoints = useRef<DataPoint[]>([]);

  useEffect(() => {
    // Generate 3000 random points in 3D space
    const points: DataPoint[] = [];
    for (let i = 0; i < 3000; i++) {
      points.push({
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z: (Math.random() - 0.5) * 2,
        id: i
      });
    }
    dataPoints.current = points;
  }, []);

  // Top 10 similar vectors (pre-calculated for demo)
  const topResults = [
    { id: 234, distance: 0.042 },
    { id: 891, distance: 0.067 },
    { id: 1523, distance: 0.089 },
    { id: 445, distance: 0.103 },
    { id: 2187, distance: 0.128 },
    { id: 778, distance: 0.145 },
    { id: 1654, distance: 0.167 },
    { id: 992, distance: 0.189 },
    { id: 2401, distance: 0.203 },
    { id: 1289, distance: 0.221 }
  ];

  const queryTarget = { x: 0.2, y: 0.3, z: -0.1 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Clear
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);

      // 3D projection matrices
      const scale = 300;
      const centerX = width / 2;
      const centerY = height / 2;

      const cosX = Math.cos(rotation.x);
      const sinX = Math.sin(rotation.x);
      const cosY = Math.cos(rotation.y);
      const sinY = Math.sin(rotation.y);

      const project3D = (x: number, y: number, z: number) => {
        // Rotate around X axis
        let y1 = y * cosX - z * sinX;
        let z1 = y * sinX + z * cosX;

        // Rotate around Y axis
        let x1 = x * cosY + z1 * sinY;
        let z2 = -x * sinY + z1 * cosY;

        // Perspective projection
        const perspective = 600;
        const factor = perspective / (perspective + z2);

        return {
          x: centerX + x1 * scale * factor,
          y: centerY + y1 * scale * factor,
          z: z2,
          factor
        };
      };

      // Draw grid lines
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i += 0.25) {
        ctx.beginPath();
        const p1 = project3D(i, -1, 0);
        const p2 = project3D(i, 1, 0);
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();

        ctx.beginPath();
        const p3 = project3D(-1, i, 0);
        const p4 = project3D(1, i, 0);
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p4.x, p4.y);
        ctx.stroke();
      }

      // Draw all data points
      dataPoints.current.forEach(point => {
        const proj = project3D(point.x, point.y, point.z);

        ctx.fillStyle = '#00FF41';
        ctx.globalAlpha = 0.3 + (proj.z + 1) * 0.2;

        const size = 1.5 * proj.factor;
        ctx.fillRect(proj.x - size/2, proj.y - size/2, size, size);
      });

      ctx.globalAlpha = 1;

      if (queryActive) {
        // Draw query target crosshair
        const targetProj = project3D(queryTarget.x, queryTarget.y, queryTarget.z);

        ctx.strokeStyle = '#00FF41';
        ctx.lineWidth = 2;
        const crossSize = 12;

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(targetProj.x - crossSize, targetProj.y);
        ctx.lineTo(targetProj.x + crossSize, targetProj.y);
        ctx.moveTo(targetProj.x, targetProj.y - crossSize);
        ctx.lineTo(targetProj.x, targetProj.y + crossSize);
        ctx.stroke();

        // Outer ring
        ctx.beginPath();
        ctx.arc(targetProj.x, targetProj.y, 8, 0, Math.PI * 2);
        ctx.stroke();

        // Draw similarity vectors to top 10 results
        topResults.forEach((result, idx) => {
          const resultPoint = dataPoints.current[result.id];
          if (!resultPoint) return;

          const resultProj = project3D(resultPoint.x, resultPoint.y, resultPoint.z);

          // Draw line
          ctx.strokeStyle = `rgba(0, 255, 65, ${0.6 - idx * 0.04})`;
          ctx.lineWidth = 2 - idx * 0.1;
          ctx.beginPath();
          ctx.moveTo(targetProj.x, targetProj.y);
          ctx.lineTo(resultProj.x, resultProj.y);
          ctx.stroke();

          // Highlight result point
          ctx.fillStyle = '#00FF41';
          const resultSize = 4;
          ctx.fillRect(resultProj.x - resultSize/2, resultProj.y - resultSize/2, resultSize, resultSize);

          // Draw distance label
          const midX = (targetProj.x + resultProj.x) / 2;
          const midY = (targetProj.y + resultProj.y) / 2;

          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillStyle = '#00FF41';
          ctx.fillText(`dist: ${result.distance.toFixed(3)}`, midX + 5, midY);
        });
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [rotation, queryActive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = () => {
      const parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setLastMouse({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;

    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;

    setRotation(prev => ({
      x: prev.x + dy * 0.01,
      y: prev.y + dx * 0.01
    }));

    setLastMouse({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="flex-1 flex flex-col bg-[#020617] border-b border-[#333] relative">
      {/* Header */}
      <div className="h-10 border-b border-[#333] bg-[#020617] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="text-[#00FF41] font-mono text-xs uppercase tracking-wider font-bold">
            3D UMAP PROJECTION
          </div>
          <div className="text-gray-500 font-mono text-[10px]">
            [RENDERING 3,000 VECTORS IN R³]
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setQueryActive(!queryActive)}
            className={`px-2 py-1 border font-mono text-[10px] uppercase tracking-wider transition-none ${
              queryActive
                ? 'border-[#00FF41] text-[#00FF41] bg-[#00FF41]/10'
                : 'border-gray-600 text-gray-500'
            }`}
          >
            {queryActive ? 'QUERY: ACTIVE' : 'QUERY: IDLE'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative overflow-hidden">
        <canvas
          ref={canvasRef}
          className="w-full h-full cursor-move"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />

        {/* Coordinate system indicator */}
        <div className="absolute bottom-4 left-4 font-mono text-[10px] text-gray-500 space-y-1 pointer-events-none select-none">
          <div>X: <span className="text-[#00FF41]">{rotation.y.toFixed(2)}°</span></div>
          <div>Y: <span className="text-[#00FF41]">{rotation.x.toFixed(2)}°</span></div>
          <div className="text-[8px] text-gray-600 mt-2">DRAG TO ROTATE</div>
        </div>

        {/* Stats overlay */}
        <div className="absolute top-4 right-4 font-mono text-[10px] bg-[#020617]/80 border border-[#333] p-3 space-y-1 pointer-events-none select-none">
          <div className="text-[#00FF41] uppercase tracking-wider mb-2">VECTOR SPACE STATS</div>
          <div>DIMENSIONS: <span className="text-white">384</span></div>
          <div>EMBEDDINGS: <span className="text-white">3,000</span></div>
          <div>SIMILARITY: <span className="text-white">COSINE</span></div>
          <div>REDUCTION: <span className="text-white">UMAP</span></div>
        </div>
      </div>
    </div>
  );
}
