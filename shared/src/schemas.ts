import { z } from 'zod';

export const MoodEnum = z.enum([
  'joyful',
  'calm',
  'neutral',
  'anxious',
  'sad',
  'angry',
  'mixed',
]);
export type Mood = z.infer<typeof MoodEnum>;

export const LocationInputSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: z.enum(['gps', 'manual']).default('gps'),
}).strict();
export type LocationInput = z.infer<typeof LocationInputSchema>;

export const LocationDataSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geohash: z.string().optional(),
  placeName: z.string().max(200).optional(),
  source: z.enum(['gps', 'manual']).default('gps'),
});
export type LocationData = z.infer<typeof LocationDataSchema>;
export const LocationSchema = LocationDataSchema;
export const StoredLocationSchema = LocationDataSchema;
export type StoredLocation = LocationData;

// Hard limits. These are the server's numbers: the form may mirror them for a better
// experience, but nothing here is enforced by the client.
export const MESSAGE_TEXT_LIMIT = 4000;
/** Turns of history loaded from Firestore and sent to the model. Cost is an availability threat. */
export const MAX_HISTORY_TURNS = 20;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;

/**
 * Message text is TRUNCATED at MESSAGE_TEXT_LIMIT rather than rejected: a long paste should
 * not lose someone their entry. The outer bound still rejects — an unbounded field is a
 * payload attack, and anything past 4x the limit is not a person typing.
 */
const messageText = z
  .string()
  .trim()
  .min(1)
  .max(MESSAGE_TEXT_LIMIT * 4)
  .transform((v) => v.slice(0, MESSAGE_TEXT_LIMIT));

export const CreateMessageSchema = z.object({
  text: messageText,
}).strict();
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

export const CreateSessionSchema = z.object({
  initialMessage: messageText.optional(),
}).strict();
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

/** Cursor pagination. A client asking for more than the server maximum is clamped, not refused. */
export const ListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().catch(DEFAULT_PAGE_SIZE)
    .transform((v) => Math.min(v, MAX_PAGE_SIZE))
    .default(DEFAULT_PAGE_SIZE),
  // A cursor is a Firestore document id under the caller's own subtree. Constrained to id
  // characters so it can never carry a path separator and address a different collection.
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
}).strict();
export type ListQueryInput = z.infer<typeof ListQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const FinalizeSessionSchema = z.object({
  location: LocationInputSchema.nullable().optional(),
}).strict();
export type FinalizeSessionInput = z.infer<typeof FinalizeSessionSchema>;

export const GeminiFinalizeOutputSchema = z.object({
  title: z.string().trim().min(1).max(60),
  summary: z.string().trim().min(1).max(1200),
  mood: MoodEnum,
  moodScore: z.number().min(-5).max(5),
  moodReason: z.string().trim().min(1).max(300),
  tags: z.array(z.string().trim().min(1).max(20)).max(5),
}).strict();
export type GeminiFinalizeOutput = z.infer<typeof GeminiFinalizeOutputSchema>;

export const UpdateEntrySchema = z.object({
  title: z.string().trim().min(1).max(60).optional(),
  summary: z.string().trim().min(1).max(1200).optional(),
  tags: z.array(z.string().trim().min(1).max(20)).max(5).optional(),
}).strict();
export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>;

export const ReverseGeocodeSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
}).strict();
export type ReverseGeocodeInput = z.infer<typeof ReverseGeocodeSchema>;

/** Firestore document ids as they appear in a path parameter. */
export const DocIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const UserRoleSchema = z.enum(['user', 'admin']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const SetUserRoleSchema = z.object({
  role: UserRoleSchema,
}).strict();
export type SetUserRoleInput = z.infer<typeof SetUserRoleSchema>;

export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    correlationId: string;
  };
}

export interface EntryDoc {
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  mood: Mood;
  moodScore: number;
  moodReason: string;
  tags: string[];
  location: LocationData | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDoc {
  id: string;
  title: string;
  status: 'active' | 'finalized';
  messageCount: number;
  entryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDoc {
  id: string;
  role: 'user' | 'model';
  text: string;
  createdAt: string;
}

export interface DailyAggregateDoc {
  date: string;
  totalEntries: number;
  activeUsers: number;
  moodDistribution: Record<Mood, number> | null;
  avgMoodScore: number | null;
  suppressed?: boolean;
  updatedAt: string;
}

// --------------------------------------------------------------------------------------
// M3: Mood Insights & Dashboard Schemas
// --------------------------------------------------------------------------------------

export const InsightRangeEnum = z.enum(['7d', '30d', '90d']);
export type InsightRange = z.infer<typeof InsightRangeEnum>;

export const InsightQuerySchema = z.object({
  range: InsightRangeEnum.default('30d'),
}).strict();
export type InsightQueryInput = z.infer<typeof InsightQuerySchema>;

export const MoodTimelinePointSchema = z.object({
  date: z.string(),
  averageScore: z.number(),
  entryCount: z.number(),
  dominantMood: MoodEnum,
  reasons: z.array(z.string()),
});
export type MoodTimelinePoint = z.infer<typeof MoodTimelinePointSchema>;

export const MoodDistributionItemSchema = z.object({
  mood: MoodEnum,
  count: z.number(),
  percentage: z.number(),
});
export type MoodDistributionItem = z.infer<typeof MoodDistributionItemSchema>;

export const TagFrequencySchema = z.object({
  tag: z.string(),
  count: z.number(),
});
export type TagFrequency = z.infer<typeof TagFrequencySchema>;

export const MoodHighlightEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  mood: MoodEnum,
  moodScore: z.number(),
  moodReason: z.string(),
  createdAt: z.string(),
  tags: z.array(z.string()),
});
export type MoodHighlightEntry = z.infer<typeof MoodHighlightEntrySchema>;

export const MoodInsightResponseSchema = z.object({
  range: InsightRangeEnum,
  totalEntries: z.number(),
  averageMoodScore: z.number(),
  timeline: z.array(MoodTimelinePointSchema),
  distribution: z.array(MoodDistributionItemSchema),
  topTags: z.array(TagFrequencySchema),
  highlights: z.array(MoodHighlightEntrySchema),
  truncated: z.boolean(),
});
export type MoodInsightResponse = z.infer<typeof MoodInsightResponseSchema>;