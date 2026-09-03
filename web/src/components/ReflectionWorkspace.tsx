import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Anchor,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Heart,
  HelpCircle,
  MapPin,
  RefreshCw,
  Send,
  Sparkles,
  Tag,
  Trash2,
} from 'lucide-react';
import { MESSAGE_TEXT_LIMIT, type EntryDoc, type MessageDoc, type SessionDoc } from '@journal/shared';
import { SafeMarkdown } from './SafeMarkdown';
import { MoodBadge } from './MoodBadge';
import { journalApi } from '../lib/journalApi';

/**
 * Ported from the AI Studio baseline. Two things changed, both structural:
 *
 *  1. Every Firestore write the baseline made from the browser is gone. This component holds
 *     no database handle at all — it calls props that go through `/api/*`, which is the only
 *     writer, because `firestore.rules` denies client writes outright.
 *  2. The input buffer is cleared only after the server confirms the write. A failed save
 *     leaves the text exactly where it was and offers Retry.
 */

export interface ReflectionWorkspaceProps {
  session: SessionDoc | null;
  messages: MessageDoc[];
  entry: EntryDoc | null;
  isLoading: boolean;
  loadError: string | null;
  onReloadMessages: () => void;
  onSend: (text: string) => Promise<{ ok: boolean; error?: string }>;
  onFinalize: (location?: { lat: number; lng: number } | null) => Promise<{ ok: boolean; error?: string }>;
  onRequestDelete: (session: SessionDoc) => void;
  isSending: boolean;
  isFinalizing: boolean;
}

interface StarterPrompt {
  id: string;
  icon: typeof HelpCircle;
  text: string;
}

const STARTER_PROMPTS: StarterPrompt[] = [
  {
    id: 'decision',
    icon: HelpCircle,
    text: 'Reflecting on a challenging decision I need to make...',
  },
  {
    id: 'gratitude',
    icon: Heart,
    text: 'What went well today and why I feel grateful...',
  },
  {
    id: 'bottleneck',
    icon: Sparkles,
    text: 'Working through a bottleneck I keep circling around...',
  },
  {
    id: 'anchor',
    icon: Anchor,
    text: 'Processing feeling overwhelmed and finding my anchor...',
  },
];

const formatMessageTime = (isoString: string): string => {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const ReflectionWorkspace: React.FC<ReflectionWorkspaceProps> = ({
  session,
  messages,
  entry,
  isLoading,
  loadError,
  onReloadMessages,
  onSend,
  onFinalize,
  onRequestDelete,
  isSending,
  isFinalizing,
}) => {
  const [inputText, setInputText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Location Privacy Triad State (Opt-in by default, precision degradation)
  const [locationOptIn, setLocationOptIn] = useState(false);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [placeNamePreview, setPlaceNamePreview] = useState<string | null>(null);
  const [isFetchingLocation, setIsFetchingLocation] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionIdRef = useRef(session?.id);
  activeSessionIdRef.current = session?.id;
  const submittingRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Reset composer & location capture state when session changes
  useEffect(() => {
    setInputText('');
    setSendError(null);
    setPendingText(null);
    setLocationOptIn(false);
    setLocationCoords(null);
    setPlaceNamePreview(null);
    setLocationNotice(null);
  }, [session?.id]);

  const isFinalized = session?.status === 'finalized';

  const handleToggleLocation = () => {
    if (locationOptIn) {
      setLocationOptIn(false);
      setLocationCoords(null);
      setPlaceNamePreview(null);
      setLocationNotice(null);
      return;
    }

    if (!('geolocation' in navigator)) {
      setLocationNotice('Geolocation is not supported in this browser.');
      return;
    }

    setIsFetchingLocation(true);
    setLocationNotice(null);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        // Precision degradation (~1.1 km city-level resolution)
        const rawLat = position.coords.latitude;
        const rawLng = position.coords.longitude;
        const sanitizeZero = (n: number) => (Object.is(n, -0) ? 0 : n);
        const lat = sanitizeZero(Number(rawLat.toFixed(2)));
        const lng = sanitizeZero(Number(rawLng.toFixed(2)));
        const coords = { lat, lng };

        setLocationCoords(coords);
        setLocationOptIn(true);
        setIsFetchingLocation(false);

        try {
          const rev = await journalApi.reverseGeocode(lat, lng);
          setPlaceNamePreview(rev.placeName);
        } catch {
          setPlaceNamePreview(`${lat.toFixed(2)}°, ${lng.toFixed(2)}°`);
        }
      },
      (err) => {
        setIsFetchingLocation(false);
        // Graceful degradation: show subtle notice, reflection authoring & saving continue uninterrupted
        setLocationNotice(
          err.code === 1
            ? 'Location permission denied. Reflection will save smoothly without location.'
            : 'Could not detect location. Reflection will save without location.'
        );
        setLocationOptIn(false);
        setLocationCoords(null);
      },
      { timeout: 8000, enableHighAccuracy: false }
    );
  };

  const submit = async (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || isSending || submittingRef.current || !session || isFinalized) return;

    const currentSessionId = session.id;
    submittingRef.current = true;
    setSendError(null);
    const previousInput = inputText;

    // Clear input if sending the current textarea content or an explicit retry matching current input
    if (!textToSend || previousInput.trim() === text) {
      setInputText('');
    }

    try {
      const result = await onSend(text);

      // Guard against session switches mid-flight
      if (activeSessionIdRef.current !== currentSessionId) return;

      if (result.ok) {
        setPendingText(null);
        if (inputText.trim() === text) {
          setInputText('');
        }
      } else {
        // The words stay in the box. Losing someone's writing to a transient failure is the
        // worst thing this app can do, so text is restored on write failure and Retry re-sends the same text.
        setPendingText(text);
        setInputText(textToSend && previousInput.trim() !== text ? previousInput : text);
        setSendError(result.error ?? 'Could not save your message.');
      }
    } finally {
      submittingRef.current = false;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const finalize = async () => {
    setFinalizeError(null);
    const result = await onFinalize(locationOptIn ? locationCoords : null);
    if (!result.ok) setFinalizeError(result.error ?? 'Could not save this reflection.');
  };

  const copy = async (message: MessageDoc) => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard permission denied — not worth interrupting the user for */
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  // ---- empty state: nothing selected -------------------------------------------------
  if (!session) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#FAF8F5] text-center p-8">
        <div className="w-12 h-12 rounded-2xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6]">
          <Sparkles className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold font-serif text-[#4A443F]">Nothing open yet</h3>
        <p className="mt-2 text-xs text-[#7D756D] max-w-sm leading-relaxed">
          Start a new reflection from the sidebar, or pick one you have written before. Your
          entries are readable only by your account.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAF8F5] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[#E2DDD5] flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-base sm:text-lg font-bold font-serif text-[#4A443F] truncate">
            {session.title}
          </h2>
          <div className="flex items-center space-x-3 mt-1">
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                isFinalized
                  ? 'bg-[#5A5A40] text-[#FAF8F5]'
                  : 'bg-[#EAE5DD] text-[#5A5A40] border border-[#DCD3C6]'
              }`}
            >
              {isFinalized ? 'Saved as entry' : 'In progress'}
            </span>
            <span className="flex items-center space-x-1.5 text-[11px] text-[#7D756D]">
              {isSending ? (
                <>
                  <RefreshCw className="w-3 h-3 text-[#5A5A40] animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3 h-3 text-[#5A5A40]" />
                  <span>{session.messageCount} messages saved</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {!isFinalized && (
            <button
              onClick={handleToggleLocation}
              disabled={isSending || isFinalizing || isFetchingLocation}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer border ${
                locationOptIn && locationCoords
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-[#FAF8F5] hover:bg-[#EFECE6] text-[#7D756D] border-[#DCD3C6]'
              }`}
              title={
                locationOptIn
                  ? 'Location attached (~1.1km precision) — click to remove'
                  : 'Attach location (opt-in)'
              }
            >
              {isFetchingLocation ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#5A5A40]" />
              ) : (
                <MapPin className={`w-3.5 h-3.5 ${locationOptIn ? 'text-emerald-600' : 'text-[#7D756D]'}`} />
              )}
              <span className="truncate max-w-[130px]">
                {isFetchingLocation
                  ? 'Detecting…'
                  : locationOptIn && locationCoords
                  ? placeNamePreview || `${locationCoords.lat}°, ${locationCoords.lng}°`
                  : 'Add Location'}
              </span>
            </button>
          )}

          <button
            onClick={() => onRequestDelete(session)}
            disabled={isSending || isFinalizing}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#FAF8F5] hover:bg-rose-50 border border-[#DCD3C6] hover:border-rose-200 text-[#7D756D] hover:text-rose-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            title="Delete this reflection"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span className="hidden sm:inline">Delete</span>
          </button>

          <button
            onClick={() => void finalize()}
            disabled={isFinalized || messages.length === 0 || isSending || isFinalizing}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#EFECE6] border border-[#DCD3C6] text-[#4A443F] rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
            title={isFinalized ? 'Already saved as an entry' : 'Summarise this conversation into a journal entry'}
          >
            {isFinalizing ? (
              <RefreshCw className="w-3.5 h-3.5 text-[#5A5A40] animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-[#5A5A40]" />
            )}
            <span>{isFinalizing ? 'Summarising…' : 'Save as entry'}</span>
          </button>
        </div>
      </div>

      {/* Location notice banner for graceful degradation */}
      {locationNotice && (
        <div className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-3 text-xs text-amber-800 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{locationNotice}</span>
          </div>
          <button
            onClick={() => setLocationNotice(null)}
            className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Save / finalize failures, with a retry that does not lose anything */}
      {(sendError || finalizeError) && (
        <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 flex items-center justify-between gap-3 text-xs text-rose-800">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{sendError ?? finalizeError}</span>
          </div>
          <button
            onClick={() => (sendError ? void submit(inputText.trim() || (pendingText ?? '')) : void finalize())}
            disabled={isSending || isFinalizing}
            className="px-2.5 py-1 bg-rose-600 text-white rounded font-medium hover:bg-rose-700 transition-colors disabled:opacity-50 shrink-0 inline-flex items-center space-x-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 shrink-0" />
            <span>Retry save</span>
          </button>
        </div>
      )}

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center text-xs text-[#7D756D]">
            <div className="w-6 h-6 border-2 border-[#5A5A40] border-t-transparent rounded-full animate-spin mb-3" />
            Loading this conversation…
          </div>
        ) : loadError ? (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <AlertCircle className="w-6 h-6 text-rose-600 mb-2" />
            <p className="text-xs text-[#4A443F] font-semibold">{loadError}</p>
            <button
              onClick={onReloadMessages}
              className="mt-3 px-3 py-1.5 bg-[#5A5A40] text-[#FAF8F5] rounded-lg text-xs font-semibold hover:bg-[#484833]"
            >
              Try again
            </button>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto py-12">
            <div className="w-12 h-12 rounded-2xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6]">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold font-serif text-[#4A443F]">Start your reflection</h3>
            <p className="mt-2 text-xs text-[#7D756D] leading-relaxed">
              Write whatever is on your mind. Nothing is sent anywhere except your own account,
              and the conversation becomes a journal entry when you save it.
            </p>
            <div className="mt-6 w-full space-y-2 text-left">
              <span className="text-[11px] font-semibold text-[#8C827A] uppercase tracking-wider block mb-1">
                Suggested openers
              </span>
              {STARTER_PROMPTS.map((prompt) => {
                const Icon = prompt.icon;
                return (
                  <button
                    key={prompt.id}
                    onClick={() => void submit(prompt.text)}
                    disabled={isSending}
                    className="w-full p-2.5 rounded-xl bg-white hover:bg-[#EFECE6] border border-[#E2DDD5] text-xs text-[#4A443F] transition-all text-left flex items-center space-x-2.5 disabled:opacity-50 cursor-pointer group"
                  >
                    <div className="w-6 h-6 rounded-lg bg-[#FAF8F5] group-hover:bg-[#EAE5DD] border border-[#E2DDD5] flex items-center justify-center text-[#5A5A40] shrink-0 transition-colors">
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <span className="flex-1">{prompt.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isUser = message.role === 'user';
            const isOptimistic = message.id.startsWith('optimistic-');
            return (
              <div
                key={message.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} ${
                  isOptimistic ? 'animate-fadeIn' : ''
                }`}
              >
                <div className="flex items-center space-x-2 mb-1.5 px-1">
                  <span className="text-[11px] font-bold text-[#7D756D]">
                    {isUser ? 'You' : 'Companion'}
                  </span>
                  <span className="text-[10px] text-[#A3988E]">
                    {isOptimistic ? 'Sending…' : formatMessageTime(message.createdAt)}
                  </span>
                </div>

                <div
                  className={`group relative max-w-2xl rounded-2xl p-4 text-xs sm:text-sm leading-relaxed shadow-2xs ${
                    isUser
                      ? 'bg-[#5A5A40] text-[#FAF8F5] rounded-tr-none'
                      : 'bg-white text-[#4A443F] border border-[#E2DDD5] rounded-tl-none'
                  } ${isOptimistic ? 'opacity-90' : ''}`}
                >
                  {isUser ? (
                    <p className="whitespace-pre-wrap">{message.text}</p>
                  ) : (
                    <SafeMarkdown text={message.text} />
                  )}

                  {!isOptimistic && (
                    <button
                      onClick={() => void copy(message)}
                      className={`absolute bottom-2 right-2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity ${
                        isUser ? 'hover:bg-[#484833] text-[#DCD3C6]' : 'hover:bg-[#EAE5DD] text-[#7D756D]'
                      }`}
                      title="Copy text"
                      aria-label="Copy message text"
                    >
                      {copiedId === message.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {isSending && (
          <div className="flex flex-col items-start">
            <span className="text-[11px] font-bold text-[#7D756D] mb-1 px-1">Companion</span>
            <div className="p-4 rounded-2xl rounded-tl-none bg-white border border-[#E2DDD5] flex items-center space-x-3 text-xs text-[#7D756D]">
              <div className="flex space-x-1.5">
                {[0, 150, 300].map((delay) => (
                  <div
                    key={delay}
                    className="w-2 h-2 rounded-full bg-[#5A5A40] animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
              <span>Thinking it through…</span>
            </div>
          </div>
        )}

        {/* The finalized entry: the structured record this conversation became */}
        {entry && (
          <div className="rounded-2xl border border-[#DCD3C6] bg-[#EFECE6] p-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold font-serif text-[#4A443F]">{entry.title}</h3>
              <MoodBadge mood={entry.mood} score={entry.moodScore} className="text-[11px] px-2.5 py-0.5" />
            </div>
            <p className="text-xs text-[#4A443F] leading-relaxed whitespace-pre-wrap">{entry.summary}</p>
            <p className="text-[11px] text-[#7D756D] italic">Why this score: {entry.moodReason}</p>

            {entry.location && (
              <div className="flex items-center space-x-1.5 text-[11px] text-[#5A5A40] bg-white p-2 rounded-lg border border-[#DCD3C6]">
                <MapPin className="w-3.5 h-3.5 text-[#5A5A40] shrink-0" />
                <span className="truncate font-medium">
                  {entry.location.placeName ||
                    `${entry.location.lat.toFixed(2)}°, ${entry.location.lng.toFixed(2)}°`}
                </span>
                <span className="text-[10px] text-[#8C827A] ml-auto shrink-0">
                  ~1.1km city-level
                </span>
              </div>
            )}

            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center space-x-1 text-[10px] px-2 py-0.5 rounded-full bg-white border border-[#DCD3C6] text-[#7D756D]"
                  >
                    <Tag className="w-2.5 h-2.5 text-[#7D756D] shrink-0" />
                    <span>{tag}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="p-4 border-t border-[#E2DDD5]">
        {isFinalized ? (
          <p className="text-xs text-[#7D756D] text-center py-2">
            This reflection is saved as an entry. Start a new one to keep writing.
          </p>
        ) : (
          <div className="relative border border-[#DCD3C6] rounded-xl focus-within:ring-2 focus-within:ring-[#5A5A40] bg-white transition-all">
            <textarea
              ref={inputRef}
              rows={3}
              placeholder="What are you processing today?"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isSending}
              className="w-full p-3 text-xs sm:text-sm text-[#4A443F] placeholder-[#A3988E] focus:outline-none resize-none disabled:opacity-60 bg-transparent"
            />
            <div className="px-3 pb-2.5 flex items-center justify-between">
              <span
                className={`text-[10px] ${
                  inputText.length > MESSAGE_TEXT_LIMIT ? 'text-rose-600 font-semibold' : 'text-[#8C827A]'
                }`}
              >
                {inputText.length} / {MESSAGE_TEXT_LIMIT} characters
                {inputText.length > MESSAGE_TEXT_LIMIT && ' — the server keeps the first 4000'}
              </span>
              <button
                onClick={() => void submit()}
                disabled={!inputText.trim() || isSending}
                className="flex items-center space-x-1.5 px-4 py-1.5 bg-[#5A5A40] hover:bg-[#484833] text-[#FAF8F5] rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
              >
                <span>Send</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
