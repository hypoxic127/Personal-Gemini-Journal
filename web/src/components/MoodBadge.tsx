import React from 'react';
import { twMerge } from 'tailwind-merge';
import { getMoodTheme } from '../lib/moodTheme';

export interface MoodBadgeProps {
  mood: string;
  score?: number | null;
  className?: string;
  iconSize?: string;
  showText?: boolean;
  scoreFormat?: 'dot' | 'paren';
  'aria-label'?: string;
}

export const MoodBadge: React.FC<MoodBadgeProps> = ({
  mood,
  score,
  className = '',
  iconSize = 'w-3.5 h-3.5',
  showText = true,
  scoreFormat = 'dot',
  'aria-label': customAriaLabel,
}) => {
  const theme = getMoodTheme(mood);
  const Icon = theme.icon;

  const scoreText =
    typeof score === 'number' && Number.isFinite(score)
      ? score > 0
        ? `+${score}`
        : `${score === 0 ? 0 : score}`
      : null;

  const accessibleLabel =
    customAriaLabel ??
    (scoreText !== null
      ? `Mood: ${theme.name}, score ${scoreText}`
      : `Mood: ${theme.name}`);

  return (
    <span
      role="status"
      aria-label={accessibleLabel}
      className={twMerge(
        'inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border',
        theme.bg,
        theme.text,
        theme.border,
        className
      )}
    >
      <Icon className={`${iconSize} shrink-0`} aria-hidden="true" />
      {showText && <span className="capitalize">{theme.name}</span>}
      {scoreText !== null && (
        <span>
          {scoreFormat === 'paren' ? `(${scoreText})` : `· ${scoreText}`}
        </span>
      )}
    </span>
  );
};
