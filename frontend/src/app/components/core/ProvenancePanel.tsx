import { Table2, ImageIcon, ArrowRight } from 'lucide-react';
import type { ProvenanceSource, SourceBranch } from './TelemetryTypes';

interface ProvenancePanelProps {
  sources?: ProvenanceSource[];
}

const BRANCH_LABEL: Record<SourceBranch, string> = {
  dense: 'Dense',
  sparse: 'Sparse',
  both: 'Both',
  colpali: 'ColPali',
};

const BRANCH_COLOR: Record<SourceBranch, string> = {
  dense: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  sparse: 'text-orange-400 bg-orange-400/10 border-orange-400/30',
  both: 'text-[#00FF41] bg-[#00FF41]/10 border-[#00FF41]/30',
  colpali: 'text-purple-400 bg-purple-400/10 border-purple-400/30',
};

// Fusion rank → final rank as one glyph, rather than two separate numeric columns — the
// movement itself (phase 6 §2.3: "the single most informative column for a reviewer") is
// what this renders, not just the two endpoints. A candidate the reranker promoted from
// rank 4 to rank 1 reads at a glance; a raw "4" next to a raw "1" in separate cells does not.
function RankMovement({ fusionRank, finalRank }: { fusionRank: number | null; finalRank: number | null }) {
  if (fusionRank == null || finalRank == null) {
    return <span className="text-gray-600">—</span>;
  }
  const delta = fusionRank - finalRank;
  const color = delta > 0 ? 'text-[#00FF41]' : delta < 0 ? 'text-red-400' : 'text-gray-500';
  return (
    <span className="flex items-center gap-1.5 justify-end font-bold">
      <span className="text-gray-500">#{fusionRank}</span>
      <ArrowRight size={11} className="text-gray-600" />
      <span className="text-white">#{finalRank}</span>
      {delta !== 0 && <span className={`${color} text-[10px]`}>({delta > 0 ? '+' : ''}{delta})</span>}
    </span>
  );
}

export function ProvenancePanel({ sources = [] }: ProvenancePanelProps) {
  return (
    <div className="flex-1 border-t border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20 relative overflow-hidden min-h-0">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span className="flex items-center gap-2">
          <Table2 size={14} className="text-white" /> Source Provenance
          <span className="text-[#00FF41] ml-2 font-normal">({sources.length} sources)</span>
        </span>
      </div>

      <div className="flex-1 overflow-auto bg-black custom-scrollbar relative">
        <table className="w-full text-left border-collapse">
          <thead className="sticky top-0 bg-[#0A0A0A] shadow-md z-10">
            <tr className="border-b border-[#333] text-gray-500 uppercase text-[10px] tracking-widest font-bold">
              <th className="py-3 px-4 w-12">Rank</th>
              <th className="py-3 px-4">Kind / Source</th>
              <th className="py-3 px-4">Text Snippet</th>
              <th className="py-3 px-4 text-center">Branch</th>
              <th className="py-3 px-4 text-center">Absorbed</th>
              <th className="py-3 px-4 text-right">Fusion → Final</th>
              <th className="py-3 px-4 text-right">Score</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-600 font-bold uppercase tracking-widest">
                  Awaiting Query...
                </td>
              </tr>
            )}
            {sources.map((s, i) => (
              <tr key={s.pointId || i} className="border-b border-[#222] hover:bg-[#111] transition-colors group cursor-default align-top">
                <td className="py-2.5 px-4 text-gray-600 font-bold group-hover:text-white">#{s.finalRank ?? i + 1}</td>
                <td className="py-2.5 px-4">
                  <div className="flex items-start gap-2">
                    {s.kind === 'page' && s.imageUri ? (
                      <img
                        src={s.imageUri}
                        alt={`Scanned page ${s.page ?? ''} of ${s.fileName}`}
                        className="w-10 h-14 object-cover border border-[#333] shrink-0"
                        loading="lazy"
                      />
                    ) : s.kind === 'page' ? (
                      <div className="w-10 h-14 flex items-center justify-center border border-[#333] bg-[#111] shrink-0">
                        <ImageIcon size={14} className="text-gray-600" />
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1">
                      <span className="text-[#00FF41] text-[10px] font-bold uppercase bg-[#00FF41]/10 px-2 py-1 border border-[#00FF41]/20 w-fit">
                        {s.fileName || 'Unknown'}
                      </span>
                      <span className="text-gray-500 text-[10px]">
                        {s.kind === 'page' ? `scanned page ${s.page}` : s.headingPath || (s.page ? `page ${s.page}` : 'text chunk')}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-4 text-gray-400 max-w-xl leading-relaxed text-[11px] whitespace-pre-wrap">
                  {s.text ? s.text.slice(0, 240) + (s.text.length > 240 ? '…' : '') : '—'}
                </td>
                <td className="py-2.5 px-4 text-center">
                  {s.branch ? (
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 border ${BRANCH_COLOR[s.branch]}`}>
                      {BRANCH_LABEL[s.branch]}
                    </span>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-center text-gray-400">
                  {s.absorbedChunks && s.absorbedChunks.length > 0 ? (
                    <span title={`${s.absorbedChunks.length} OCR chunk(s) absorbed into this page`}>
                      {s.absorbedChunks.length}
                    </span>
                  ) : (
                    <span className="text-gray-700">—</span>
                  )}
                </td>
                <td className="py-2.5 px-4 text-right">
                  <RankMovement fusionRank={s.fusionRank} finalRank={s.finalRank} />
                </td>
                <td className="py-2.5 px-4 text-right">
                  <span className="text-[#00FF41] font-bold font-mono bg-[#00FF41]/10 px-2 py-1 border border-[#00FF41]/30">
                    {s.score != null ? s.score.toFixed(4) : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
