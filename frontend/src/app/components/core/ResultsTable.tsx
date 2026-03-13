import { Table2, Download, Copy } from 'lucide-react';

interface SearchResult {
  documentId: string;
  content: string;
  similarity: number;
}

interface ResultsTableProps {
  results?: SearchResult[];
}

export function ResultsTable({ results = [] }: ResultsTableProps) {
  return (
    <div className="flex-1 border-t border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-20 relative overflow-hidden">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span className="flex items-center gap-2"><Table2 size={14} className="text-white" /> Results Set <span className="text-[#00FF41] ml-2 font-normal">({results.length} nodes)</span></span>
        <div className="flex gap-4">
           <button className="hover:text-white transition-colors flex items-center gap-1"><Copy size={12} /> Copy JSON</button>
           <button className="hover:text-[#00FF41] transition-colors flex items-center gap-1"><Download size={12} /> Export</button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto bg-black p-0 custom-scrollbar relative">
         <table className="w-full text-left border-collapse">
           <thead className="sticky top-0 bg-[#0A0A0A] shadow-md z-10">
             <tr className="border-b border-[#333] text-gray-500 uppercase text-[10px] tracking-widest font-bold">
               <th className="py-3 px-4 w-16">Rank</th>
               <th className="py-3 px-4">Document ID</th>
               <th className="py-3 px-4">Similarity Score</th>
               <th className="py-3 px-4">Source Engine</th>
               <th className="py-3 px-4 text-right">Re-rank Delta</th>
             </tr>
           </thead>
           <tbody>
             {results.length === 0 && (
               <tr>
                 <td colSpan={5} className="py-8 text-center text-gray-600 font-bold uppercase tracking-widest">Awaiting Query...</td>
               </tr>
             )}
             {results.map((r, i) => (
               <tr key={r.documentId} className="border-b border-[#222] hover:bg-[#111] transition-colors group cursor-default">
                 <td className="py-2.5 px-4 text-gray-600 font-bold group-hover:text-white">#{i + 1}</td>
                 <td className="py-2.5 px-4 text-gray-300 font-bold tracking-wide">{r.documentId}</td>
                 <td className="py-2.5 px-4 text-[#00FF41] font-bold bg-[#00FF41]/5 border-l border-r border-transparent group-hover:border-[#00FF41]/20 group-hover:bg-[#00FF41]/10 transition-colors">
                   {r.similarity.toFixed(4)}
                 </td>
                 <td className="py-2.5 px-4 text-gray-400 uppercase text-[10px] tracking-wider font-bold">
                   <span className="bg-[#222] px-2 py-1 border border-[#333]">MongoDB Atlas</span>
                 </td>
                 <td className="py-2.5 px-4 text-right font-bold tracking-wider">
                     <span className="text-[#00FF41] bg-[#00FF41]/10 px-2 py-1 border border-[#00FF41]/30">Native ▲</span>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
      </div>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #000;
          border-left: 1px solid #333;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #333;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>
    </div>
  );
}