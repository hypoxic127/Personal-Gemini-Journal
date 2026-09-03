import type { LucideIcon } from 'lucide-react';
import {
  Sun,
  Smile,
  Compass,
  Minus,
  CloudRain,
  Flame,
  CloudDrizzle,
} from 'lucide-react';
import type { Mood } from '@journal/shared';

export interface MoodThemeInfo {
  label: string;
  name: string;
  color: string;
  bg: string;
  text: string;
  border: string;
  icon: LucideIcon;
}

/**
 * Standard 7 moods matching @journal/shared schema enum.
 */
export const STANDARD_MOODS: Mood[] = [
  'joyful',
  'calm',
  'neutral',
  'anxious',
  'sad',
  'angry',
  'mixed',
];

/**
 * Mood theme mappings pairing emotional sentiments with dedicated Lucide vector icons
 * and mood-specific color themes (emerald, teal, sky, slate, amber, rose, indigo).
 */
export const MOOD_THEME: Record<Mood, MoodThemeInfo> & Record<string, MoodThemeInfo> = {
  joyful: {
    label: 'Joyful / 喜悦',
    name: 'Joyful',
    color: '#10B981',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    icon: Sun,
  },
  calm: {
    label: 'Calm / 平静',
    name: 'Calm',
    color: '#0D9488',
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    icon: Smile,
  },
  reflective: {
    label: 'Reflective / 沉思',
    name: 'Reflective',
    color: '#0284C7',
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-200',
    icon: Compass,
  },
  mixed: {
    label: 'Reflective / 沉思',
    name: 'Reflective',
    color: '#0284C7',
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-200',
    icon: Compass,
  },
  neutral: {
    label: 'Neutral / 中性',
    name: 'Neutral',
    color: '#64748B',
    bg: 'bg-slate-50',
    text: 'text-slate-800',
    border: 'border-slate-200',
    icon: Minus,
  },
  anxious: {
    label: 'Anxious / 焦虑',
    name: 'Anxious',
    color: '#F59E0B',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    icon: CloudRain,
  },
  frustrated: {
    label: 'Frustrated / 沮丧',
    name: 'Frustrated',
    color: '#F43F5E',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    icon: Flame,
  },
  angry: {
    label: 'Angry / 愤怒',
    name: 'Frustrated',
    color: '#F43F5E',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    icon: Flame,
  },
  melancholic: {
    label: 'Melancholic / 忧郁',
    name: 'Melancholic',
    color: '#6366F1',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    icon: CloudDrizzle,
  },
  sad: {
    label: 'Sad / 低落',
    name: 'Melancholic',
    color: '#6366F1',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    icon: CloudDrizzle,
  },
};

/**
 * Safe accessor returning mood theme with fallback to neutral.
 */
export function getMoodTheme(mood?: unknown): MoodThemeInfo {
  if (typeof mood !== 'string' || !mood.trim()) return MOOD_THEME.neutral;
  const trimmed = mood.trim();
  const key = trimmed.toLowerCase();
  const theme = MOOD_THEME[key];
  if (theme) return theme;

  // Safe fallback for unmapped/custom mood strings:
  // Use neutral slate styling + Minus icon, but preserve the custom mood string.
  const formattedName = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return {
    ...MOOD_THEME.neutral,
    name: formattedName,
    label: `${formattedName} / 中性`,
  };
}

/**
 * Safe accessor returning Lucide vector icon component for a given mood.
 */
export function getMoodIcon(mood?: unknown): LucideIcon {
  return getMoodTheme(mood).icon;
}
