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

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  geohash: z.string().optional(),
  placeName: z.string().max(200).optional(),
  source: z.enum(['gps', 'manual']).default('gps'),
});
export type LocationData = z.infer<typeof LocationSchema>;

export const CreateMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
}).strict();
export type CreateMessageInput = z.infer<typeof CreateMessageSchema>;

export const CreateSessionSchema = z.object({
  initialMessage: z.string().trim().min(1).max(4000).optional(),
}).strict();
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;

export const FinalizeSessionSchema = z.object({
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
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