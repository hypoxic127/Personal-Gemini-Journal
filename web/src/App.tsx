import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EntryDoc, MessageDoc, SessionDoc } from '@journal/shared';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { ThreatSummaryTable } from './components/ThreatSummaryTable';
import { ReflectionWorkspace } from './components/ReflectionWorkspace';
import { EntryHistorySidebar } from './components/EntryHistorySidebar';
import { MoodDashboard } from './components/MoodDashboard';
import { ErrorBoundary } from './components/ErrorBoundary';
import { describeError, journalApi } from './lib/journalApi';

const DeleteConfirmation: React.FC<{
  session: SessionDoc;
  isDeleting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ session, isDeleting, error, onCancel, onConfirm }) => (
  <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
    <div className="bg-[#FAF8F5] rounded-2xl border border-[#DCD3C6] max-w-md w-full p-6 space-y-4">
      <div className="flex items-start space-x-3">
        <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-[#4A443F]">Delete this reflection?</h3>
          <p className="mt-1.5 text-xs text-[#7D756D] leading-relaxed">
            “{session.title}” and its {session.messageCount} messages will be deleted, along
            with the entry it produced. This cannot be undone.
          </p>
        </div>
      </div>

      {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{error}</p>}

      <div className="flex justify-end space-x-2">
        <button
          onClick={onCancel}
          disabled={isDeleting}
          className="px-3 py-1.5 text-xs font-semibold text-[#4A443F] bg-[#EAE5DD] hover:bg-[#DFD8CE] rounded-lg disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          onClick={onConfirm}
          disabled={isDeleting}
          className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50"
        >
          {isDeleting ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  </div>
);

const Journal: React.FC<{ onOpenThreatModal: () => void }> = ({ onOpenThreatModal }) => {
  const { user, profile, role, signOut, refreshProfile } = useAuth();

  const [activeView, setActiveView] = useState<'workspace' | 'insights'>('workspace');
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [activeSession, setActiveSession] = useState<SessionDoc | null>(null);
  const [messages, setMessages] = useState<MessageDoc[]>([]);
  const [entry, setEntry] = useState<EntryDoc | null>(null);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [isSending, setIsSending] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SessionDoc | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const upsertSession = useCallback((updated: SessionDoc) => {
    setSessions((current) => {
      const without = current.filter((s) => s.id !== updated.id);
      return [updated, ...without];
    });
  }, []);

  const loadSessions = useCallback(async () => {
    setIsLoadingSessions(true);
    setSessionsError(null);
    try {
      const page = await journalApi.listSessions();
      setSessions(page.items);
      setCursor(page.nextCursor);
    } catch (err) {
      setSessionsError(describeError(err, 'Could not load your reflections.'));
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    try {
      const page = await journalApi.listSessions(cursor);
      setSessions((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setSessionsError(describeError(err, 'Could not load more reflections.'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const openSession = useCallback(async (session: SessionDoc) => {
    setActiveSession(session);
    setMessages([]);
    setEntry(null);
    setMessagesError(null);
    setIsLoadingMessages(true);

    try {
      const page = await journalApi.listMessages(session.id);
      setMessages(page.items);
      if (session.entryId) setEntry(await journalApi.getEntry(session.entryId));
    } catch (err) {
      setMessagesError(describeError(err, 'Could not load this conversation.'));
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const startNew = useCallback(async () => {
    setMessagesError(null);
    try {
      const { session } = await journalApi.createSession();
      upsertSession(session);
      setActiveSession(session);
      setMessages([]);
      setEntry(null);
    } catch (err) {
      setSessionsError(describeError(err, 'Could not start a new reflection.'));
    }
  }, [upsertSession]);

  /**
   * Returns a result rather than throwing: the workspace decides what to do with a failure,
   * and what it does is keep the user's text and offer Retry.
   */
  const send = useCallback(
    async (text: string): Promise<{ ok: boolean; error?: string }> => {
      if (!activeSession) return { ok: false, error: 'No reflection is open.' };
      setIsSending(true);
      try {
        const turn = await journalApi.sendMessage(activeSession.id, text);
        setMessages((current) => [...current, turn.userMessage, turn.modelMessage]);
        const updated = {
          ...activeSession,
          messageCount: activeSession.messageCount + 2,
          updatedAt: new Date().toISOString(),
        };
        setActiveSession(updated);
        upsertSession(updated);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: describeError(err, 'Could not save your message.') };
      } finally {
        setIsSending(false);
      }
    },
    [activeSession, upsertSession]
  );

  const finalize = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    if (!activeSession) return { ok: false, error: 'No reflection is open.' };
    setIsFinalizing(true);
    try {
      const saved = await journalApi.finalize(activeSession.id);
      setEntry(saved);
      const updated: SessionDoc = {
        ...activeSession,
        status: 'finalized',
        entryId: saved.id,
        title: saved.title,
        updatedAt: new Date().toISOString(),
      };
      setActiveSession(updated);
      upsertSession(updated);
      void refreshProfile();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: describeError(err, 'Could not save this reflection as an entry.') };
    } finally {
      setIsFinalizing(false);
    }
  }, [activeSession, refreshProfile, upsertSession]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await journalApi.deleteSession(deleteTarget.id);
      setSessions((current) => current.filter((s) => s.id !== deleteTarget.id));
      if (activeSession?.id === deleteTarget.id) {
        setActiveSession(null);
        setMessages([]);
        setEntry(null);
      }
      setDeleteTarget(null);
      void refreshProfile();
    } catch (err) {
      setDeleteError(describeError(err, 'Could not delete this reflection.'));
    } finally {
      setIsDeleting(false);
    }
  }, [activeSession, deleteTarget, refreshProfile]);

  return (
    <div className="h-screen flex flex-col bg-[#F5F2ED]">
      <Navbar
        user={user}
        role={role}
        entryCount={profile?.entryCount ?? 0}
        activeView={activeView}
        onViewChange={setActiveView}
        onSignOut={signOut}
        onNewReflection={() => {
          setActiveView('workspace');
          void startNew();
        }}
        onOpenThreatModal={onOpenThreatModal}
      />

      {activeView === 'insights' ? (
        <MoodDashboard
          onStartReflection={() => {
            setActiveView('workspace');
            void startNew();
          }}
        />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <EntryHistorySidebar
            sessions={sessions}
            activeSessionId={activeSession?.id ?? null}
            isLoading={isLoadingSessions}
            error={sessionsError}
            hasMore={Boolean(cursor)}
            isLoadingMore={isLoadingMore}
            onRetry={() => void loadSessions()}
            onLoadMore={() => void loadMore()}
            onSelect={(session) => void openSession(session)}
            onNew={() => void startNew()}
            onRequestDelete={(session) => {
              setDeleteError(null);
              setDeleteTarget(session);
            }}
          />

          <ReflectionWorkspace
            session={activeSession}
            messages={messages}
            entry={entry}
            isLoading={isLoadingMessages}
            loadError={messagesError}
            onReloadMessages={() => activeSession && void openSession(activeSession)}
            onSend={send}
            onFinalize={finalize}
            onRequestDelete={(session) => {
              setDeleteError(null);
              setDeleteTarget(session);
            }}
            isSending={isSending}
            isFinalizing={isFinalizing}
          />
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmation
          session={deleteTarget}
          isDeleting={isDeleting}
          error={deleteError}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </div>
  );
};

const AppContent: React.FC = () => {
  const { user, isLoading, authError, signInWithGoogle } = useAuth();
  const [isThreatModalOpen, setIsThreatModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-[#5A5A40] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#7D756D] font-medium">Verifying authentication session...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {!user ? (
        <LandingPage
          onSignIn={signInWithGoogle}
          isLoading={isLoading}
          onOpenThreatModal={() => setIsThreatModalOpen(true)}
          authError={authError}
        />
      ) : (
        <Journal onOpenThreatModal={() => setIsThreatModalOpen(true)} />
      )}

      <ThreatSummaryTable isOpen={isThreatModalOpen} onClose={() => setIsThreatModalOpen(false)} />
    </>
  );
};

export const App: React.FC = () => (
  <ErrorBoundary>
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  </ErrorBoundary>
);
