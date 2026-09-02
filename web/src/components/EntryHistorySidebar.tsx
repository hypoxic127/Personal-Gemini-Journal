import React, { useState } from 'react';
import { AlertCircle, Calendar, MessageSquare, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import type { SessionDoc } from '@journal/shared';

/**
 * Ported from the AI Studio baseline. The list is served by `GET /api/sessions` with cursor
 * pagination — the browser never queries Firestore directly.
 *
 * The baseline's mood filter is a status filter here: a mood belongs to a finalized entry,
 * and filtering the conversation list by it would mean either loading every entry up front
 * or an unbounded query. Search filters the page already loaded, which is what "search"
 * honestly means without a search index.
 */

export interface EntryHistorySidebarProps {
  sessions: SessionDoc[];
  activeSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  onRetry: () => void;
  onLoadMore: () => void;
  onSelect: (session: SessionDoc) => void;
  onNew: () => void;
  onRequestDelete: (session: SessionDoc) => void;
}

type StatusFilter = 'all' | 'active' | 'finalized';

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'In progress' },
  { value: 'finalized', label: 'Saved' },
];

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const EntryHistorySidebar: React.FC<EntryHistorySidebarProps> = ({
  sessions,
  activeSessionId,
  isLoading,
  error,
  hasMore,
  isLoadingMore,
  onRetry,
  onLoadMore,
  onSelect,
  onNew,
  onRequestDelete,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const visible = sessions.filter((session) => {
    const matchesSearch = session.title.toLowerCase().includes(searchTerm.trim().toLowerCase());
    const matchesStatus = status === 'all' || session.status === status;
    return matchesSearch && matchesStatus;
  });

  const isFiltered = searchTerm.trim().length > 0 || status !== 'all';

  return (
    <aside className="w-full md:w-80 bg-[#FAF8F5] border-r border-[#E2DDD5] flex flex-col h-full overflow-hidden shrink-0">
      <div className="p-4 border-b border-[#E2DDD5]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <h2 className="text-sm font-bold text-[#4A443F] font-serif tracking-tight">
              Your reflections
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-[#EAE5DD] text-[#5A5A40] text-xs font-semibold">
              {sessions.length}
            </span>
          </div>
          <button
            onClick={onNew}
            className="p-1.5 bg-[#EAE5DD] hover:bg-[#DFD8CE] text-[#5A5A40] rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1"
            title="Start a new reflection"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New</span>
          </button>
        </div>

        <div className="relative mb-2">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#A3988E]" />
          <input
            type="text"
            placeholder="Search loaded reflections…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-[#DCD3C6] rounded-lg text-xs text-[#4A443F] placeholder-[#A3988E] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]"
          />
        </div>

        <div className="flex items-center space-x-1 text-[11px]">
          {FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => setStatus(filter.value)}
              className={`px-2.5 py-0.5 rounded-full whitespace-nowrap font-medium transition-colors ${
                status === filter.value
                  ? 'bg-[#5A5A40] text-[#FAF8F5]'
                  : 'bg-[#EAE5DD] text-[#7D756D] hover:bg-[#DFD8CE]'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <div className="p-8 text-center text-[#7D756D] text-xs flex flex-col items-center">
            <div className="w-5 h-5 border-2 border-[#5A5A40] border-t-transparent rounded-full animate-spin mb-2" />
            Loading your reflections…
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertCircle className="w-5 h-5 text-rose-600 mx-auto mb-2" />
            <p className="text-xs text-[#4A443F] font-semibold">{error}</p>
            <button
              onClick={onRetry}
              className="mt-3 px-3 py-1.5 bg-[#5A5A40] text-[#FAF8F5] rounded-lg text-xs font-semibold hover:bg-[#484833]"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-[#7D756D] text-xs">
            {isFiltered ? (
              <p>Nothing here matches that filter.</p>
            ) : (
              <div>
                <Sparkles className="w-6 h-6 text-[#A3988E] mx-auto mb-2" />
                <p className="font-semibold text-[#4A443F]">No reflections yet</p>
                <p className="mt-1">Press New to start your first one.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {visible.map((session) => {
              const isActive = session.id === activeSessionId;
              return (
                <div
                  key={session.id}
                  onClick={() => onSelect(session)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(session);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`group relative p-3 rounded-xl border transition-all cursor-pointer text-left ${
                    isActive
                      ? 'bg-white border-[#5A5A40] ring-1 ring-[#5A5A40]/30'
                      : 'bg-white/80 hover:bg-white border-[#E2DDD5] hover:border-[#DCD3C6]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-bold text-[#4A443F] truncate leading-snug flex-1">
                      {session.title}
                    </h3>
                    {session.status === 'finalized' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#EAE5DD] text-[#5A5A40] border border-[#DCD3C6] font-medium shrink-0">
                        Saved
                      </span>
                    )}
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-[#EFECE6] flex items-center justify-between text-[10px] text-[#8C827A]">
                    <div className="flex items-center space-x-1.5">
                      <Calendar className="w-3 h-3 text-[#A3988E]" />
                      <span>{formatDate(session.updatedAt)}</span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="flex items-center space-x-0.5 text-[#5A5A40] font-semibold">
                        <MessageSquare className="w-2.5 h-2.5" />
                        <span>{session.messageCount}</span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDelete(session);
                        }}
                        className="text-[#A3988E] hover:text-rose-600 hover:bg-rose-50 transition-colors p-1 rounded-md opacity-70 group-hover:opacity-100"
                        title="Delete reflection"
                        aria-label={`Delete ${session.title}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {hasMore && (
              <button
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="w-full py-2 text-xs font-semibold text-[#5A5A40] bg-[#EAE5DD] hover:bg-[#DFD8CE] rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoadingMore ? 'Loading…' : 'Load older reflections'}
              </button>
            )}
          </>
        )}
      </div>

      <div className="p-3 bg-[#EFECE6] border-t border-[#E2DDD5] text-[11px] text-[#7D756D] flex items-center space-x-2">
        <div className="w-2 h-2 rounded-full bg-[#5A5A40]" />
        <span className="truncate">Readable only by your account</span>
      </div>
    </aside>
  );
};
