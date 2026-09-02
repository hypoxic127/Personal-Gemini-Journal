import React, { useEffect, useState, useCallback } from 'react';
import {
  TrendingUp,
  Smile,
  Tag,
  BookOpen,
  Calendar,
  AlertCircle,
  RefreshCw,
  Sparkles,
  HelpCircle,
  ArrowRight,
  PieChart as PieIcon,
  Activity,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import type { InsightRange, Mood, MoodInsightResponse } from '@journal/shared';
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

interface MoodDashboardProps {
  onStartReflection: () => void;
}

export const MoodDashboard: React.FC<MoodDashboardProps> = ({ onStartReflection }) => {
  const [range, setRange] = useState<InsightRange>('30d');
  const [data, setData] = useState<MoodInsightResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInsights = useCallback(async (selectedRange: InsightRange) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await journalApi.getMoodInsights(selectedRange);
      setData(res);
    } catch (err) {
      setError(describeError(err, 'Failed to aggregate mood trajectory.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInsights(range);
  }, [loadInsights, range]);

  // Determine dominant mood overall (only from counts > 0)
  let dominantMoodOverall: Mood = 'neutral';
  let maxCount = 0;
  if (data?.distribution) {
    for (const item of data.distribution) {
      if (item.count > maxCount) {
        maxCount = item.count;
        dominantMoodOverall = item.mood;
      }
    }
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F2ED] p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header & Range Selector */}
      <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-[#5A5A40] text-[#FAF8F5] flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </div>
            <h2 className="text-lg font-bold font-serif text-[#4A443F]">
              Mood Cartography & Explainable Insights
            </h2>
          </div>
          <p className="text-xs text-[#7D756D]">
            Track emotional patterns over time with AI-grounded reasoning and theme attribution.
          </p>
        </div>

        {/* Range Selector Buttons */}
        <div className="flex items-center space-x-1.5 bg-[#EFECE6] p-1 rounded-xl border border-[#DCD3C6] self-start md:self-auto">
          {(['7d', '30d', '90d'] as InsightRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                range === r
                  ? 'bg-[#5A5A40] text-[#FAF8F5] shadow-2xs'
                  : 'text-[#7D756D] hover:text-[#4A443F] hover:bg-[#E6E1D8]'
              }`}
            >
              {r === '7d' ? 'Last 7 Days' : r === '30d' ? 'Last 30 Days' : 'Last 90 Days'}
            </button>
          ))}
          <button
            onClick={() => void loadInsights(range)}
            title="Refresh Insights"
            className="p-1.5 text-[#7D756D] hover:text-[#4A443F] rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-[#EAE5DD] rounded-2xl" />
          ))}
          <div className="md:col-span-3 h-80 bg-[#EAE5DD] rounded-2xl" />
          <div className="h-80 bg-[#EAE5DD] rounded-2xl" />
        </div>
      )}

      {/* Error State */}
      {!isLoading && error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
          <h3 className="text-sm font-bold text-rose-900">Could not calculate insights</h3>
          <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
          <button
            onClick={() => void loadInsights(range)}
            className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 cursor-pointer"
          >
            Retry Aggregation
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && (!data || data.totalEntries === 0) && (
        <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-12 text-center space-y-4 max-w-xl mx-auto shadow-2xs">
          <div className="w-12 h-12 rounded-2xl bg-[#EFECE6] text-[#5A5A40] flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-bold font-serif text-[#4A443F]">
              No reflections recorded in this timeframe
            </h3>
            <p className="text-xs text-[#7D756D] leading-relaxed">
              Start a reflective dialogue with Gemini to map your mood fluctuations, uncover thinking patterns, and receive grounded explainability insights.
            </p>
          </div>
          <button
            onClick={onStartReflection}
            className="inline-flex items-center space-x-2 px-4 py-2.5 bg-[#5A5A40] text-[#FAF8F5] rounded-xl text-xs font-semibold hover:bg-[#484833] shadow-xs cursor-pointer"
          >
            <span>Start Your First Reflection</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Active Data Visualizations */}
      {!isLoading && !error && data && data.totalEntries > 0 && (
        <div className="space-y-6">
          {/* Summary Stat Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Entries */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Recorded Entries</span>
                <BookOpen className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="text-2xl font-bold font-serif text-[#4A443F]">
                {data.totalEntries}
              </div>
              <p className="text-[11px] text-[#8C827A]">
                In the selected {range === '7d' ? '7-day' : range === '30d' ? '30-day' : '90-day'} window
              </p>
            </div>

            {/* Card 2: Average Score */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Average Mood Score</span>
                <TrendingUp className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="flex items-baseline space-x-2">
                <span className="text-2xl font-bold font-serif text-[#4A443F]">
                  {data.averageMoodScore > 0 ? `+${data.averageMoodScore}` : data.averageMoodScore}
                </span>
                <span className="text-xs text-[#8C827A]">/ 5.0</span>
              </div>
              <div className="w-full bg-[#EAE5DD] h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#5A5A40] rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, ((data.averageMoodScore + 5) / 10) * 100))}%` }}
                />
              </div>
            </div>

            {/* Card 3: Dominant Mood */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Dominant State</span>
                <Smile className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-lg">{(MOOD_THEME[dominantMoodOverall] || MOOD_THEME.neutral).emoji}</span>
                <span className="text-base font-bold font-serif text-[#4A443F] capitalize">
                  {dominantMoodOverall}
                </span>
              </div>
              <p className="text-[11px] text-[#8C827A]">
                Most frequent emotional state
              </p>
            </div>

            {/* Card 4: Active Themes */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Key Reflection Themes</span>
                <Tag className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="text-2xl font-bold font-serif text-[#4A443F]">
                {data.topTags.length}
              </div>
              <p className="text-[11px] text-[#8C827A]">
                Distinct topics identified by AI
              </p>
            </div>
          </div>

          {/* Charts Row: Mood Trajectory + Mood Distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart 1: Mood Trajectory Line / Area Chart */}
            <div className="lg:col-span-2 bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                    Emotional Trajectory & Sentiment Trend
                  </h3>
                  <p className="text-[11px] text-[#7D756D]">
                    Daily average score ranging from -5 (Heavy / Stressed) to +5 (Elevated / Joyful)
                  </p>
                </div>
              </div>

              <div className="h-64 sm:h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.timeline} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="moodGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#5A5A40" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#5A5A40" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: '#7D756D' }}
                      tickLine={false}
                      axisLine={{ stroke: '#DCD3C6' }}
                      tickFormatter={(d: string) => d.slice(5)} // MM-DD
                    />
                    <YAxis
                      domain={[-5, 5]}
                      ticks={[-5, -2.5, 0, 2.5, 5]}
                      tick={{ fontSize: 10, fill: '#7D756D' }}
                      tickLine={false}
                      axisLine={{ stroke: '#DCD3C6' }}
                    />
                    <ReferenceLine y={0} stroke="#DCD3C6" strokeDasharray="3 3" />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const point = payload[0].payload as MoodInsightResponse['timeline'][0];
                        if (!point) return null;
                        const theme = MOOD_THEME[point.dominantMood] || MOOD_THEME.neutral;
                        return (
                          <div className="bg-[#FAF8F5] border border-[#DCD3C6] rounded-xl p-3 shadow-lg max-w-xs space-y-2 text-xs">
                            <div className="flex items-center justify-between border-b border-[#E2DDD5] pb-1.5">
                              <span className="font-bold text-[#4A443F]">{point.date}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${theme.bg} ${theme.text} ${theme.border} border`}>
                                {theme.emoji} {point.dominantMood}
                              </span>
                            </div>
                            <div className="space-y-1 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-[#7D756D]">Score:</span>
                                <span className="font-bold text-[#4A443F]">{point.averageScore > 0 ? `+${point.averageScore}` : point.averageScore}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-[#7D756D]">Entries:</span>
                                <span className="text-[#4A443F]">{point.entryCount}</span>
                              </div>
                            </div>
                            {point.reasons && point.reasons.length > 0 && (
                              <div className="pt-1.5 border-t border-[#E2DDD5] space-y-1">
                                <span className="text-[10px] font-bold text-[#5A5A40] block">AI Reasoning Summary:</span>
                                <ul className="list-disc list-inside text-[10px] text-[#7D756D] space-y-0.5 leading-tight">
                                  {point.reasons.map((r, idx) => (
                                    <li key={idx} className="truncate" title={r}>{r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="averageScore"
                      stroke="#5A5A40"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#moodGradient)"
                      dot={{ fill: '#5A5A40', r: 3 }}
                      activeDot={{ r: 5, fill: '#484833' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Mood Distribution Donut Chart */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-1.5">
                  <PieIcon className="w-4 h-4 text-[#5A5A40]" />
                  <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                    Mood Distribution
                  </h3>
                </div>
                <p className="text-[11px] text-[#7D756D]">
                  Breakdown across 7 emotional classifications
                </p>
              </div>

              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.distribution.filter((d) => d.count > 0)}
                      dataKey="count"
                      nameKey="mood"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                    >
                      {data.distribution
                        .filter((d) => d.count > 0)
                        .map((entry) => (
                          <Cell key={entry.mood} fill={(MOOD_THEME[entry.mood] || MOOD_THEME.neutral).color} />
                        ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const item = payload[0].payload as MoodInsightResponse['distribution'][0];
                        if (!item) return null;
                        const theme = MOOD_THEME[item.mood] || MOOD_THEME.neutral;
                        return (
                          <div className="bg-[#FAF8F5] border border-[#DCD3C6] rounded-xl p-2.5 shadow-lg text-xs space-y-1">
                            <span className="font-bold text-[#4A443F] capitalize">
                              {theme.emoji} {item.mood}
                            </span>
                            <div className="text-[11px] text-[#7D756D]">
                              {item.count} {item.count === 1 ? 'entry' : 'entries'} ({item.percentage}%)
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Legend
                      formatter={(val: Mood) => (
                        <span className="text-[10px] text-[#4A443F] capitalize font-medium">
                          {val}
                        </span>
                      )}
                      iconSize={8}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="pt-2 border-t border-[#E2DDD5] text-center">
                <span className="text-[11px] text-[#8C827A]">
                  Total {data.totalEntries} evaluated reflection{data.totalEntries === 1 ? '' : 's'}
                </span>
              </div>
            </div>
          </div>

          {/* Bottom Row: Top Themes (Tags) & AI Explainability Highlights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Top Themes / Tags */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-3">
              <div className="flex items-center space-x-2">
                <Tag className="w-4 h-4 text-[#5A5A40]" />
                <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                  Frequent Themes
                </h3>
              </div>
              <p className="text-[11px] text-[#7D756D]">
                Topics and subjects extracted during reflection sessions
              </p>

              {data.topTags.length === 0 ? (
                <p className="text-xs text-[#8C827A] italic py-4 text-center">No tags generated yet</p>
              ) : (
                <div className="flex flex-wrap gap-2 pt-2">
                  {data.topTags.map(({ tag, count }) => (
                    <span
                      key={tag}
                      className="inline-flex items-center space-x-1.5 px-3 py-1 bg-[#EFECE6] border border-[#DCD3C6] rounded-full text-xs text-[#4A443F] font-medium"
                    >
                      <span>#{tag}</span>
                      <span className="w-4 h-4 rounded-full bg-[#5A5A40] text-[#FAF8F5] text-[10px] flex items-center justify-center font-bold">
                        {count}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* AI Explainability & Attribution Highlights */}
            <div className="lg:col-span-2 bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <HelpCircle className="w-4 h-4 text-[#5A5A40]" />
                  <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                    AI Explainability & Scoring Rationale
                  </h3>
                </div>
                <span className="text-[10px] font-semibold text-[#5A5A40] bg-[#EAE5DD] px-2 py-0.5 rounded-full border border-[#DCD3C6]">
                  Grounding & Transparency
                </span>
              </div>
              <p className="text-[11px] text-[#7D756D]">
                Review how Gemini analyzed contextual factors to assign specific sentiment ratings to your entries.
              </p>

              <div className="space-y-3 pt-1">
                {data.highlights.map((entry) => {
                  const theme = MOOD_THEME[entry.mood] || MOOD_THEME.neutral;
                  const dateObj = new Date(entry.createdAt);
                  const dateLabel = !Number.isNaN(dateObj.getTime())
                    ? dateObj.toLocaleDateString()
                    : entry.createdAt;
                  return (
                    <div
                      key={entry.id}
                      className="bg-[#F5F2ED] border border-[#E2DDD5] rounded-xl p-3.5 space-y-2 hover:border-[#DCD3C6] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-xs font-bold text-[#4A443F] leading-tight">
                            {entry.title}
                          </h4>
                          <span className="text-[10px] text-[#8C827A] flex items-center space-x-1 mt-0.5">
                            <Calendar className="w-3 h-3" />
                            <span>{dateLabel}</span>
                          </span>
                        </div>
                        <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${theme.bg} ${theme.text} ${theme.border} border shrink-0`}>
                          <span>{theme.emoji}</span>
                          <span className="capitalize">{entry.mood}</span>
                          <span>({entry.moodScore > 0 ? `+${entry.moodScore}` : entry.moodScore})</span>
                        </span>
                      </div>

                      {entry.moodReason && (
                        <p className="text-[11px] text-[#635B54] bg-[#FAF8F5] border-l-2 border-[#5A5A40] p-2 rounded-r-lg leading-relaxed italic">
                          "{entry.moodReason}"
                        </p>
                      )}

                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {entry.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[9px] px-1.5 py-0.5 bg-[#EAE5DD] text-[#7D756D] rounded font-medium"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};