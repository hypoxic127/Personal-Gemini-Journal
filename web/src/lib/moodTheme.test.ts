import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Sun,
  Smile,
  Compass,
  Minus,
  CloudRain,
  Flame,
  CloudDrizzle,
  HelpCircle,
  Heart,
  Sparkles,
  Anchor,
  BookOpen,
  TrendingUp,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Tag,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  MOOD_THEME,
  STANDARD_MOODS,
  getMoodTheme,
  getMoodIcon,
} from './moodTheme';
import { MoodBadge } from '../components/MoodBadge';

describe('Mood Theme System & Vector Icon Mappings (R1)', () => {
  it('defines the standard 7 moods matching schema enum', () => {
    expect(STANDARD_MOODS).toEqual([
      'joyful',
      'calm',
      'neutral',
      'anxious',
      'sad',
      'angry',
      'mixed',
    ]);
    const uniqueThemes = new Set(STANDARD_MOODS.map((m) => getMoodTheme(m).name));
    expect(uniqueThemes.size).toBe(7);
    expect(Array.from(uniqueThemes)).toEqual([
      'Joyful',
      'Calm',
      'Neutral',
      'Anxious',
      'Melancholic',
      'Frustrated',
      'Reflective',
    ]);
  });

  describe('Sentiment-to-icon and color mappings', () => {
    it('maps joyful to Sun with emerald palette', () => {
      const theme = getMoodTheme('joyful');
      expect(theme.name).toBe('Joyful');
      expect(theme.icon).toBe(Sun);
      expect(theme.color).toBe('#10B981');
      expect(theme.bg).toContain('emerald');
      expect(theme.text).toContain('emerald');
      expect(theme.border).toContain('emerald');
    });

    it('maps calm to Smile with teal palette', () => {
      const theme = getMoodTheme('calm');
      expect(theme.name).toBe('Calm');
      expect(theme.icon).toBe(Smile);
      expect(theme.color).toBe('#0D9488');
      expect(theme.bg).toContain('teal');
      expect(theme.text).toContain('teal');
      expect(theme.border).toContain('teal');
    });

    it('maps reflective / mixed to Compass with sky palette', () => {
      const reflectiveTheme = getMoodTheme('reflective');
      expect(reflectiveTheme.name).toBe('Reflective');
      expect(reflectiveTheme.icon).toBe(Compass);
      expect(reflectiveTheme.color).toBe('#0284C7');
      expect(reflectiveTheme.bg).toContain('sky');

      const mixedTheme = getMoodTheme('mixed');
      expect(mixedTheme.name).toBe('Reflective');
      expect(mixedTheme.icon).toBe(Compass);
      expect(mixedTheme.color).toBe('#0284C7');
      expect(mixedTheme.bg).toContain('sky');
    });

    it('maps neutral to Minus with slate palette', () => {
      const theme = getMoodTheme('neutral');
      expect(theme.name).toBe('Neutral');
      expect(theme.icon).toBe(Minus);
      expect(theme.color).toBe('#64748B');
      expect(theme.bg).toContain('slate');
      expect(theme.text).toContain('slate');
      expect(theme.border).toContain('slate');
    });

    it('maps anxious to CloudRain with amber palette', () => {
      const theme = getMoodTheme('anxious');
      expect(theme.name).toBe('Anxious');
      expect(theme.icon).toBe(CloudRain);
      expect(theme.color).toBe('#F59E0B');
      expect(theme.bg).toContain('amber');
      expect(theme.text).toContain('amber');
      expect(theme.border).toContain('amber');
    });

    it('maps frustrated / angry to Flame with rose palette', () => {
      const frustratedTheme = getMoodTheme('frustrated');
      expect(frustratedTheme.name).toBe('Frustrated');
      expect(frustratedTheme.icon).toBe(Flame);
      expect(frustratedTheme.color).toBe('#F43F5E');
      expect(frustratedTheme.bg).toContain('rose');

      const angryTheme = getMoodTheme('angry');
      expect(angryTheme.name).toBe('Frustrated');
      expect(angryTheme.icon).toBe(Flame);
      expect(angryTheme.color).toBe('#F43F5E');
      expect(angryTheme.bg).toContain('rose');
    });

    it('maps melancholic / sad to CloudDrizzle with indigo palette', () => {
      const melancholicTheme = getMoodTheme('melancholic');
      expect(melancholicTheme.name).toBe('Melancholic');
      expect(melancholicTheme.icon).toBe(CloudDrizzle);
      expect(melancholicTheme.color).toBe('#6366F1');
      expect(melancholicTheme.bg).toContain('indigo');

      const sadTheme = getMoodTheme('sad');
      expect(sadTheme.name).toBe('Melancholic');
      expect(sadTheme.icon).toBe(CloudDrizzle);
      expect(sadTheme.color).toBe('#6366F1');
      expect(sadTheme.bg).toContain('indigo');
    });
  });

  describe('Robustness and edge case handling', () => {
    it('handles case-insensitivity and whitespace padding', () => {
      expect(getMoodTheme('  JOYFUL  ').name).toBe('Joyful');
      expect(getMoodTheme('  Calm ').icon).toBe(Smile);
      expect(getMoodTheme('AnXious').icon).toBe(CloudRain);
    });

    it('handles null, undefined, and empty string safely with neutral fallback', () => {
      expect(getMoodTheme(null).name).toBe('Neutral');
      expect(getMoodTheme(undefined).name).toBe('Neutral');
      expect(getMoodTheme('').name).toBe('Neutral');
      expect(getMoodTheme('   ').name).toBe('Neutral');
      expect(getMoodIcon(null)).toBe(Minus);
    });

    it('safely handles non-string runtime inputs without throwing', () => {
      expect(getMoodTheme(123 as any).name).toBe('Neutral');
      expect(getMoodTheme({} as any).name).toBe('Neutral');
      expect(getMoodTheme(true as any).name).toBe('Neutral');
      expect(getMoodTheme([] as any).name).toBe('Neutral');
      expect(getMoodIcon(456 as any)).toBe(Minus);
    });

    it('safely handles unknown / custom mood strings by preserving the name with neutral styling', () => {
      const customTheme = getMoodTheme('hopeful');
      expect(customTheme.name).toBe('Hopeful');
      expect(customTheme.icon).toBe(Minus);
      expect(customTheme.color).toBe('#64748B');
      expect(customTheme.bg).toContain('slate');
      expect(customTheme.text).toContain('slate');
      expect(customTheme.border).toContain('slate');
    });

    it('exposes direct MOOD_THEME dictionary correctly', () => {
      expect(MOOD_THEME.joyful.color).toBe('#10B981');
      expect(MOOD_THEME.calm.color).toBe('#0D9488');
      expect(MOOD_THEME.neutral.color).toBe('#64748B');
    });
  });

  describe('MoodBadge Vector Component & Accessibility', () => {
    it('renders vector icon SVG without any raw emoji characters', () => {
      const html = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'joyful', score: 4 }));
      expect(html).toContain('<svg');
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain('Joyful');
      expect(html).toContain('+4');
      // Verify no raw emoji unicode characters
      expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html)).toBe(false);
    });

    it('renders correct accessibility attributes and role', () => {
      const html = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'calm', score: -2 }));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Mood: Calm, score -2"');
    });

    it('supports parenthesis score formatting for highlights', () => {
      const html = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'anxious', score: 3, scoreFormat: 'paren' }));
      expect(html).toContain('( +3 )'.replace(/ /g, ''));
      expect(html).toContain('aria-label="Mood: Anxious, score +3"');
    });

    it('supports hiding text while maintaining accessibility', () => {
      const html = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'melancholic', showText: false }));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-label="Mood: Melancholic"');
      expect(html).not.toContain('<span class="capitalize">Melancholic</span>');
    });

    it('merges custom className via twMerge without utility conflicts', () => {
      const html = renderToStaticMarkup(
        React.createElement(MoodBadge, { mood: 'joyful', className: 'px-3 text-[12px]' })
      );
      // twMerge resolves px-2 -> px-3 and text-[10px] -> text-[12px]
      expect(html).toContain('px-3');
      expect(html).not.toContain('px-2 ');
      expect(html).toContain('text-[12px]');
      expect(html).not.toContain('text-[10px]');
    });

    it('safely handles boundary and non-finite scores (0, -0, NaN, Infinity)', () => {
      const zeroHtml = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'neutral', score: 0 }));
      expect(zeroHtml).toContain('· 0');
      expect(zeroHtml).toContain('aria-label="Mood: Neutral, score 0"');

      const negZeroHtml = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'neutral', score: -0 }));
      expect(negZeroHtml).toContain('· 0');

      const nanHtml = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'calm', score: NaN }));
      expect(nanHtml).not.toContain('NaN');
      expect(nanHtml).toContain('aria-label="Mood: Calm"');

      const infHtml = renderToStaticMarkup(React.createElement(MoodBadge, { mood: 'joyful', score: Infinity }));
      expect(infHtml).not.toContain('Infinity');
      expect(infHtml).toContain('aria-label="Mood: Joyful"');
    });
  });

  describe('Starter Prompts & Navigation Vector Icons (R2)', () => {
    it('verifies starter prompt icons render clean SVGs without emojis', () => {
      const promptIcons = [HelpCircle, Heart, Sparkles, Anchor];
      for (const Icon of promptIcons) {
        const html = renderToStaticMarkup(React.createElement(Icon, { className: 'w-3.5 h-3.5' }));
        expect(html).toContain('<svg');
        expect(html).toContain('lucide');
        expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html)).toBe(false);
      }
    });

    it('verifies navigation tab icons render clean SVGs without emojis', () => {
      const navIcons = [BookOpen, TrendingUp, Compass, ShieldAlert];
      for (const Icon of navIcons) {
        const html = renderToStaticMarkup(React.createElement(Icon, { className: 'w-3.5 h-3.5 shrink-0' }));
        expect(html).toContain('<svg');
        expect(html).toContain('lucide');
        expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html)).toBe(false);
      }
    });

    it('verifies modal & auxiliary vector status icons render correctly', () => {
      const auxIcons = [ShieldCheck, CheckCircle2, Trash2, RefreshCw, Tag, AlertCircle, X];
      for (const Icon of auxIcons) {
        const html = renderToStaticMarkup(React.createElement(Icon, { className: 'w-4 h-4' }));
        expect(html).toContain('<svg');
        expect(html).toContain('lucide');
        expect(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(html)).toBe(false);
      }
    });
  });
});
