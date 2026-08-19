import { useEffect, useState } from 'react';
import { MessageSquarePlus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useThreads } from '../../hooks/useThreads';

interface ThreadSidebarProps {
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
  onNewThread: () => void;
  // Bumped by the parent after a turn completes (a new thread may have just been
  // created, or an existing thread's title/lastMessageAt just changed) — the hook has
  // no server-push channel, so a changed signal is what tells this list to refetch.
  refreshSignal: number;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ThreadSidebar({ activeThreadId, onSelectThread, onNewThread, refreshSignal }: ThreadSidebarProps) {
  const { threads, isLoading, fetchThreads, renameThread, deleteThread } = useThreads();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads, refreshSignal]);

  const startEditing = (id: string, currentTitle: string) => {
    setEditingId(id);
    setEditValue(currentTitle);
  };

  const commitRename = async (id: string) => {
    const title = editValue.trim();
    setEditingId(null);
    if (!title) return;
    try {
      await renameThread(id, title);
    } catch (err: any) {
      toast.error('Failed to rename thread', { description: err.message });
    }
  };

  const confirmDelete = async (id: string) => {
    try {
      await deleteThread(id);
      if (activeThreadId === id) onNewThread();
    } catch (err: any) {
      toast.error('Failed to delete thread', { description: err.message });
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="w-64 shrink-0 h-full flex flex-col border-r border-line-subtle bg-surface">
      <div className="p-3 border-b border-line-subtle">
        <button
          onClick={onNewThread}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-sunken border border-line text-gray-300 hover:border-line-strong hover:text-white transition-colors text-sm"
        >
          <MessageSquarePlus size={16} />
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
        {isLoading && threads.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-600 font-mono">Loading threads…</div>
        )}
        {!isLoading && threads.length === 0 && (
          <div className="px-4 py-3 text-xs text-gray-600 font-mono">No conversations yet.</div>
        )}

        {threads.map((thread) => {
          const isActive = thread._id === activeThreadId;
          const isEditing = editingId === thread._id;
          const isPendingDelete = pendingDeleteId === thread._id;

          return (
            <div
              key={thread._id}
              onClick={() => !isEditing && onSelectThread(thread._id)}
              className={`group mx-2 mb-1 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive ? 'bg-surface-raised border border-line' : 'border border-transparent hover:bg-surface-sunken'
              }`}
            >
              {isEditing ? (
                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editValue}
                    maxLength={200}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(thread._id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 bg-surface-sunken border border-line-strong rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-line-strong"
                  />
                  <button onClick={() => commitRename(thread._id)} className="text-gray-400 hover:text-white">
                    <Check size={14} />
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-white">
                    <X size={14} />
                  </button>
                </div>
              ) : isPendingDelete ? (
                <div className="flex items-center justify-between gap-1.5" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-red-400 truncate">Delete this thread?</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => confirmDelete(thread._id)} className="text-red-400 hover:text-red-300">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setPendingDeleteId(null)} className="text-gray-400 hover:text-white">
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-1.5">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-300 truncate">{thread.title}</div>
                    <div className="text-[10px] text-gray-600 font-mono mt-0.5">
                      {relativeTime(thread.lastMessageAt)} · {thread.messageCount} msg{thread.messageCount === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="hidden group-hover:flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditing(thread._id, thread.title); }}
                      className="text-gray-500 hover:text-white"
                      title="Rename"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setPendingDeleteId(thread._id); }}
                      className="text-gray-500 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
