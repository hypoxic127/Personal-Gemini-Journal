import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  InfoWindow,
} from '@vis.gl/react-google-maps';
import {
  MapPin,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  Shield,
  Compass,
  ArrowRight,
  Filter,
  CheckCircle2,
  Globe,
} from 'lucide-react';
import type { EntryDoc, Mood } from '@journal/shared';
import { journalApi, describeError } from '../lib/journalApi';

const MOOD_THEME: Record<
  Mood,
  { label: string; color: string; bg: string; text: string; border: string; emoji: string }
> = {
  joyful: {
    label: 'Joyful / 喜悦',
    color: '#10B981',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    emoji: '✨',
  },
  calm: {
    label: 'Calm / 平静',
    color: '#06B6D4',
    bg: 'bg-cyan-50',
    text: 'text-cyan-800',
    border: 'border-cyan-200',
    emoji: '🌿',
  },
  neutral: {
    label: 'Neutral / 中性',
    color: '#64748B',
    bg: 'bg-slate-50',
    text: 'text-slate-800',
    border: 'border-slate-200',
    emoji: '☕',
  },
  anxious: {
    label: 'Anxious / 焦虑',
    color: '#F59E0B',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    emoji: '⚡',
  },
  sad: {
    label: 'Sad / 低落',
    color: '#6366F1',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    emoji: '🌧️',
  },
  angry: {
    label: 'Angry / 愤怒',
    color: '#F43F5E',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    emoji: '🔥',
  },
  mixed: {
    label: 'Mixed / 复杂',
    color: '#A855F7',
    bg: 'bg-purple-50',
    text: 'text-purple-800',
    border: 'border-purple-200',
    emoji: '🎭',
  },
};

interface MoodMapProps {
  onStartReflection: () => void;
  onOpenSession?: (sessionId: string) => void;
}

export const MoodMap: React.FC<MoodMapProps> = ({ onStartReflection, onOpenSession }) => {
  // 1. Runtime Key & Data Loading State
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<EntryDoc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 2. Filter & Selection State
  const [selectedMood, setSelectedMood] = useState<Mood | 'all'>('all');
  const [selectedEntry, setSelectedEntry] = useState<EntryDoc | null>(null);

  // 3. Privacy Triad Modal & Action State
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [clearSuccessNotice, setClearSuccessNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // 1. Fetch runtime browser key via GET /api/config (authenticated)
      const configRes = await journalApi.getMapsConfig();
      setApiKey(configRes.mapsBrowserApiKey || null);

      // 2. Fetch user's historical entries
      const entriesRes = await journalApi.listEntries();
      setEntries(entriesRes.items);
    } catch (err) {
      setError(describeError(err, 'Failed to initialize Mood Map.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Filter entries that have valid location coordinates
  const locationEntries = useMemo(() => {
    return entries.filter((e) => e.location && typeof e.location.lat === 'number' && typeof e.location.lng === 'number');
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (selectedMood === 'all') return locationEntries;
    return locationEntries.filter((e) => e.mood === selectedMood);
  }, [locationEntries, selectedMood]);

  // If active filter no longer includes selected entry, clear selection
  useEffect(() => {
    if (selectedMood !== 'all' && selectedEntry && selectedEntry.mood !== selectedMood) {
      setSelectedEntry(null);
    }
  }, [selectedMood, selectedEntry]);

  // Compute map center (default to first entry with location or standard default)
  const mapCenter = useMemo(() => {
    if (filteredEntries.length > 0) {
      const first = filteredEntries[0]!;
      return { lat: first.location!.lat, lng: first.location!.lng };
    }
    if (locationEntries.length > 0) {
      const first = locationEntries[0]!;
      return { lat: first.location!.lat, lng: first.location!.lng };
    }
    return { lat: 37.7749, lng: -122.4194 }; // San Francisco default center
  }, [filteredEntries, locationEntries]);

  // Bulk clear location handler
  const handleClearLocations = async () => {
    setIsClearing(true);
    setClearError(null);
    try {
      const res = await journalApi.clearLocations();
      // Update local state to scrub locations
      setEntries((prev) =>
        prev.map((item) => ({
          ...item,
          location: null,
        }))
      );
      setSelectedEntry(null);
      setIsClearModalOpen(false);
      setClearSuccessNotice(`Successfully scrubbed location metadata from ${res.clearedCount} reflections.`);
      setTimeout(() => setClearSuccessNotice(null), 6000);
    } catch (err) {
      setClearError(describeError(err, 'Failed to clear location history.'));
    } finally {
      setIsClearing(false);
    }
  };

  // --- 1. Loading State ---
  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#FAF8F5]">
        <div className="flex flex-col items-center space-y-3 max-w-sm text-center">
          <div className="w-10 h-10 rounded-2xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center animate-pulse">
            <Compass className="w-5 h-5 animate-spin" />
          </div>
          <h3 className="text-sm font-bold font-serif text-[#4A443F]">Loading Mood Map…</h3>
          <p className="text-xs text-[#7D756D]">
            Retrieving runtime credentials and mapping emotional geography from your private reflections.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FAF8F5] overflow-hidden">
      {/* Header & Location Privacy Triad Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-[#E2DDD5] bg-[#FAF8F5] flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-[#5A5A40] text-[#FAF8F5] flex items-center justify-center shadow-xs">
            <Compass className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm sm:text-base font-bold font-serif text-[#4A443F]">
                Emotional Geography & Mood Map
              </h2>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#EFECE6] text-[#5A5A40] border border-[#DCD3C6]">
                {locationEntries.length} {locationEntries.length === 1 ? 'place' : 'places'}
              </span>
            </div>
            <p className="text-[11px] text-[#7D756D] hidden md:block">
              Explore your reflections through geography and emotional context.
            </p>
          </div>
        </div>

        {/* Privacy Triad Badges & Actions */}
        <div className="flex items-center space-x-2">
          <div className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1 bg-[#EFECE6] border border-[#DCD3C6] rounded-lg text-[11px] text-[#5A5A40]">
            <Shield className="w-3.5 h-3.5 text-[#5A5A40]" />
            <span>Opt-in & ~1.1km Degraded</span>
          </div>

          <button
            onClick={() => {
              setClearError(null);
              setIsClearModalOpen(true);
            }}
            disabled={locationEntries.length === 0}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-[#FAF8F5] hover:bg-rose-50 border border-[#DCD3C6] hover:border-rose-300 text-[#7D756D] hover:text-rose-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 cursor-pointer"
            title="Bulk clear location history from all entries"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-600" />
            <span className="hidden sm:inline">Scrub Locations</span>
          </button>
        </div>
      </div>

      {/* Success Notification */}
      {clearSuccessNotice && (
        <div className="px-6 py-2 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between text-xs text-emerald-800 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{clearSuccessNotice}</span>
          </div>
          <button
            onClick={() => setClearSuccessNotice(null)}
            className="text-[11px] text-emerald-700 hover:text-emerald-900 font-semibold"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Chips Bar */}
      <div className="px-4 sm:px-6 py-2 bg-[#F5F2ED] border-b border-[#E2DDD5] flex items-center space-x-1.5 overflow-x-auto">
        <span className="text-[11px] font-semibold text-[#8C827A] mr-1 flex items-center shrink-0">
          <Filter className="w-3 h-3 mr-1" />
          Filter:
        </span>
        <button
          onClick={() => setSelectedMood('all')}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all cursor-pointer ${
            selectedMood === 'all'
              ? 'bg-[#5A5A40] text-white shadow-2xs'
              : 'bg-[#FAF8F5] text-[#7D756D] border border-[#DCD3C6] hover:text-[#4A443F]'
          }`}
        >
          All Moods ({locationEntries.length})
        </button>
        {(Object.keys(MOOD_THEME) as Mood[]).map((mood) => {
          const count = locationEntries.filter((e) => e.mood === mood).length;
          const theme = MOOD_THEME[mood];
          const isActive = selectedMood === mood;
          return (
            <button
              key={mood}
              onClick={() => setSelectedMood(mood)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all flex items-center space-x-1 cursor-pointer ${
                isActive
                  ? `${theme.bg} ${theme.text} border ${theme.border} ring-2 ring-[#5A5A40]/40 font-bold shadow-2xs`
                  : 'bg-[#FAF8F5] text-[#7D756D] border border-[#DCD3C6] hover:text-[#4A443F]'
              }`}
            >
              <span>{theme.emoji}</span>
              <span>{theme.label.split(' / ')[0]}</span>
              <span className="text-[10px] opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Main Map / Resilient 3-State View Container */}
      <div className="flex-1 relative flex flex-col overflow-hidden">
        {/* State A: Error or Missing API Key -> Graceful Fallback List */}
        {!apiKey || error ? (
          <div className="flex-1 flex flex-col p-6 overflow-y-auto bg-[#FAF8F5]">
            <div className="p-4 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start space-x-3">
              <Globe className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold">Interactive Google Maps in Offline / Fallback Mode</h4>
                <p className="mt-1 text-amber-800 leading-relaxed">
                  {!apiKey
                    ? 'Google Maps runtime key is not configured in this environment. Your location-tagged reflections are displayed in the secure fallback view below.'
                    : error}
                </p>
                <button
                  onClick={() => void loadData()}
                  className="mt-2.5 inline-flex items-center space-x-1.5 px-3 py-1 bg-amber-200 hover:bg-amber-300 text-amber-900 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>Retry Connection</span>
                </button>
              </div>
            </div>

            {/* Fallback Location Entries Grid */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#8C827A]">
                Location Reflections ({filteredEntries.length})
              </h3>
              {filteredEntries.length === 0 ? (
                <div className="text-center py-12 text-xs text-[#7D756D]">
                  No reflections found matching this filter.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredEntries.map((entry) => {
                    const theme = MOOD_THEME[entry.mood] ?? MOOD_THEME.neutral;
                    return (
                      <div
                        key={entry.id}
                        className="p-4 rounded-2xl bg-white border border-[#E2DDD5] shadow-2xs hover:border-[#5A5A40] transition-all flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${theme.bg} ${theme.text} border ${theme.border}`}
                            >
                              {theme.emoji} {theme.label.split(' / ')[0]} · {entry.moodScore > 0 ? '+' : ''}
                              {entry.moodScore}
                            </span>
                            <span className="text-[10px] text-[#A3988E]">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold font-serif text-[#4A443F] mb-1">{entry.title}</h4>
                          <p className="text-xs text-[#7D756D] line-clamp-2 mb-2">{entry.summary}</p>
                          <div className="flex items-center space-x-1.5 text-[11px] text-[#5A5A40] font-medium bg-[#FAF8F5] p-2 rounded-lg border border-[#EFECE6]">
                            <MapPin className="w-3.5 h-3.5 text-[#5A5A40] shrink-0" />
                            <span className="truncate">
                              {entry.location?.placeName ||
                                `${entry.location?.lat.toFixed(2)}°, ${entry.location?.lng.toFixed(2)}°`}
                            </span>
                          </div>
                        </div>

                        {onOpenSession && entry.sessionId && (
                          <button
                            onClick={() => onOpenSession(entry.sessionId)}
                            className="mt-3 text-xs font-semibold text-[#5A5A40] hover:text-[#3C3C2A] flex items-center space-x-1 self-end cursor-pointer"
                          >
                            <span>Open Reflection</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : locationEntries.length === 0 ? (
          /* State B: Empty State -> Onboarding Canvas */
          <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#FAF8F5] text-center">
            <div className="w-14 h-14 rounded-3xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6] shadow-xs">
              <Compass className="w-7 h-7 text-[#5A5A40]" />
            </div>
            <h3 className="text-base sm:text-lg font-bold font-serif text-[#4A443F]">
              No Location Reflections Yet
            </h3>
            <p className="mt-2 text-xs text-[#7D756D] max-w-md leading-relaxed">
              When finalizing reflections in the workspace, opt-in to attach your location. Your coordinates will be
              degraded to city-level precision (~1.1 km) to safeguard your movement history.
            </p>
            <button
              onClick={onStartReflection}
              className="mt-5 inline-flex items-center space-x-2 px-4 py-2 bg-[#5A5A40] hover:bg-[#484833] text-[#FAF8F5] rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Start Reflection</span>
            </button>
          </div>
        ) : (
          /* State C: Active Interactive Google Map */
          <APIProvider apiKey={apiKey}>
            <Map
              defaultCenter={mapCenter}
              defaultZoom={4}
              mapId="gemini_mood_map"
              gestureHandling="greedy"
              disableDefaultUI={false}
              className="w-full h-full"
            >
              {filteredEntries.map((entry) => {
                if (!entry.location) return null;
                const theme = MOOD_THEME[entry.mood] ?? MOOD_THEME.neutral;
                const isSelected = selectedEntry?.id === entry.id;

                return (
                  <AdvancedMarker
                    key={entry.id}
                    position={{ lat: entry.location.lat, lng: entry.location.lng }}
                    onClick={() => setSelectedEntry(entry)}
                    title={entry.title}
                  >
                    <div
                      className={`relative flex items-center justify-center transition-transform transform hover:scale-125 cursor-pointer ${
                        isSelected ? 'scale-125 z-20' : 'z-10'
                      }`}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm shadow-md border-2 border-white transition-all"
                        style={{ backgroundColor: theme.color }}
                      >
                        <span className="select-none">{theme.emoji}</span>
                      </div>
                      <div
                        className="absolute -bottom-1 w-2 h-2 rotate-45 border-r border-b border-white"
                        style={{ backgroundColor: theme.color }}
                      />
                    </div>
                  </AdvancedMarker>
                );
              })}

              {/* InfoWindow for Selected Marker */}
              {selectedEntry && selectedEntry.location && (() => {
                const selectedTheme = MOOD_THEME[selectedEntry.mood] ?? MOOD_THEME.neutral;
                return (
                  <InfoWindow
                    position={{
                      lat: selectedEntry.location.lat,
                      lng: selectedEntry.location.lng,
                    }}
                    onCloseClick={() => setSelectedEntry(null)}
                    headerDisabled={false}
                  >
                    <div className="p-2 max-w-xs space-y-2 text-[#4A443F]">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            selectedTheme.bg
                          } ${selectedTheme.text} border ${
                            selectedTheme.border
                          }`}
                        >
                          {selectedTheme.emoji} {selectedTheme.label.split(' / ')[0]} ·{' '}
                          {selectedEntry.moodScore > 0 ? '+' : ''}
                          {selectedEntry.moodScore}
                        </span>
                        <span className="text-[10px] text-[#8C827A]">
                          {new Date(selectedEntry.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                    <h4 className="text-xs font-bold font-serif leading-tight">{selectedEntry.title}</h4>

                    <div className="flex items-center space-x-1.5 text-[10px] text-[#5A5A40] bg-[#FAF8F5] p-1.5 rounded-md border border-[#E2DDD5]">
                      <MapPin className="w-3 h-3 text-[#5A5A40] shrink-0" />
                      <span className="truncate">
                        {selectedEntry.location.placeName ||
                          `${selectedEntry.location.lat.toFixed(2)}°, ${selectedEntry.location.lng.toFixed(2)}°`}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#7D756D] line-clamp-3 leading-relaxed">
                      {selectedEntry.summary}
                    </p>

                    {selectedEntry.moodReason && (
                      <p className="text-[10px] text-[#8C827A] italic bg-[#FAF8F5] p-1.5 rounded-md border border-[#EFECE6]">
                        Why: {selectedEntry.moodReason}
                      </p>
                    )}

                    {onOpenSession && selectedEntry.sessionId && (
                      <button
                        onClick={() => onOpenSession(selectedEntry.sessionId)}
                        className="w-full mt-1.5 py-1 px-2.5 bg-[#5A5A40] hover:bg-[#484833] text-[#FAF8F5] rounded-lg text-[11px] font-semibold transition-colors flex items-center justify-center space-x-1 cursor-pointer"
                      >
                        <span>Open Reflection</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </InfoWindow>
              );
            })()}
            </Map>
          </APIProvider>
        )}
      </div>

      {/* Bulk Clear Confirmation Modal */}
      {isClearModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-[#FAF8F5] rounded-2xl border border-[#DCD3C6] max-w-md w-full p-6 space-y-4 shadow-xl animate-scaleUp">
            <div className="flex items-start space-x-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#4A443F]">
                  Scrub All Historical Location Data?
                </h3>
                <p className="mt-1.5 text-xs text-[#7D756D] leading-relaxed">
                  This will permanently delete all location tags (coordinates, place names, and geohashes) from all your
                  past journal entries ({locationEntries.length} entries).
                </p>
                <p className="mt-1 text-[11px] text-[#8C827A] italic">
                  An immutable record will be appended to the server audit log. This action cannot be undone.
                </p>
              </div>
            </div>

            {clearError && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-center space-x-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{clearError}</span>
              </p>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#E2DDD5]">
              <button
                onClick={() => setIsClearModalOpen(false)}
                disabled={isClearing}
                className="px-3.5 py-1.5 text-xs font-semibold text-[#4A443F] bg-[#EAE5DD] hover:bg-[#DFD8CE] rounded-lg disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleClearLocations()}
                disabled={isClearing}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50 flex items-center space-x-1.5 cursor-pointer shadow-xs"
              >
                {isClearing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Scrubbing…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Confirm Scrub</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
