import type { EntryDoc, MessageDoc, Page, SessionDoc } from '@journal/shared';
import { api, ApiError } from './api';

/**
 * Every read and write in the journal goes through the backend. The browser holds no key,
 * writes nothing to Firestore directly, and never names a model — the model that answered a
 * turn arrives as data on the response.
 */

export interface TurnResult {
  userMessage: MessageDoc;
  modelMessage: MessageDoc;
  model: string;
}

export interface StartedSession extends Partial<TurnResult> {
  session: SessionDoc;
}

export interface MapsConfig {
  mapsBrowserApiKey: string | null;
}

export interface ReverseGeocodeResult {
  lat: number;
  lng: number;
  placeName: string;
  geohash: string;
}

export interface ClearLocationsResult {
  clearedCount: number;
  success: boolean;
}

export const journalApi = {
  createSession: (initialMessage?: string) =>
    api.post<StartedSession>('/api/sessions', initialMessage ? { initialMessage } : {}),

  listSessions: (cursor?: string) =>
    api.get<Page<SessionDoc>>(`/api/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

  deleteSession: (sessionId: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/api/sessions/${sessionId}`),

  listMessages: (sessionId: string, cursor?: string) =>
    api.get<Page<MessageDoc>>(
      `/api/sessions/${sessionId}/messages${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    ),

  sendMessage: (sessionId: string, text: string) =>
    api.post<TurnResult>(`/api/sessions/${sessionId}/messages`, { text }),

  finalize: (sessionId: string, location?: { lat: number; lng: number } | null) =>
    api.post<EntryDoc>(
      `/api/sessions/${sessionId}/finalize`,
      location ? { location: { lat: location.lat, lng: location.lng } } : {}
    ),

  getEntry: (entryId: string) => api.get<EntryDoc>(`/api/entries/${entryId}`),

  listEntries: (cursor?: string) =>
    api.get<Page<EntryDoc>>(`/api/entries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

  getMoodInsights: (range: '7d' | '30d' | '90d' = '30d') =>
    api.get<import('@journal/shared').MoodInsightResponse>(`/api/insights/mood?range=${range}`),

  getMapsConfig: () => api.get<MapsConfig>('/api/config'),

  reverseGeocode: (lat: number, lng: number) =>
    api.post<ReverseGeocodeResult>('/api/places/reverse-geocode', { lat, lng }),

  clearLocations: () =>
    api.post<ClearLocationsResult>('/api/places/clear-locations', {}),
};

/**
 * Server messages are already written for a person to read and carry no internal detail, so
 * they are shown as-is. Anything else gets a plain fallback rather than a raw exception
 * string, and a 429 is turned into the one piece of advice that actually helps.
 */
export const describeError = (err: unknown, fallback = 'Something went wrong. Please try again.'): string => {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'You are sending messages faster than the limit allows. Please wait a few seconds and retry.';
    return err.message || fallback;
  }
  if (err instanceof TypeError) return 'Cannot reach the server. Check your connection and retry.';
  return fallback;
};
