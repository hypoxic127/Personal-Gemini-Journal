import React, { useCallback, useEffect, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Users,
  BookOpen,
  TrendingUp,
  UserCheck,
  UserX,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Clock,
  PieChart as PieIcon,
  Activity,
  User as UserIcon,
  Copy,
  Check,
  EyeOff,
  History,
  Info,
  X,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import type { Mood, UserRole } from '@journal/shared';
import { useAuth } from '../auth/AuthProvider';
import {
  adminApi,
  describeError,
  type AdminStatsResponse,
  type AdminUserSummary,
} from '../lib/adminApi';
import { getMoodTheme } from '../lib/moodTheme';

interface RoleChangeModalProps {
  targetUser: AdminUserSummary | null;
  newRole: UserRole | null;
  isSubmitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const RoleChangeModal: React.FC<RoleChangeModalProps> = ({
  targetUser,
  newRole,
  isSubmitting,
  error,
  onConfirm,
  onCancel,
}) => {
  if (!targetUser || !newRole) return null;

  const isGranting = newRole === 'admin';
  const displayName = targetUser.uid;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[#FAF8F5] rounded-2xl border border-[#DCD3C6] max-w-md w-full p-6 space-y-4 shadow-xl">
        <div className="flex items-start space-x-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isGranting ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800'
            }`}
          >
            {isGranting ? <ShieldAlert className="w-5 h-5" /> : <UserX className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="text-base font-bold font-serif text-[#4A443F]">
              {isGranting ? 'Grant Admin Privileges' : 'Revoke Admin Privileges'}
            </h3>
            <p className="mt-1 text-xs text-[#7D756D] leading-relaxed">
              Changing role for <span className="font-semibold text-[#4A443F] font-mono">{displayName}</span> to{' '}
              <span className={`font-bold ${isGranting ? 'text-amber-800' : 'text-[#4A443F]'}`}>
                {isGranting ? 'Admin' : 'Standard User'}
              </span>
              .
            </p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 space-y-1">
          <div className="flex items-center space-x-1.5 font-semibold">
            <Clock className="w-3.5 h-3.5 text-amber-700" />
            <span>Token Revocation Notice</span>
          </div>
          <p className="text-[11px] text-amber-800 leading-normal">
            This action immediately revokes existing refresh tokens and takes effect on their next token
            refresh. Active sessions will be prompted to re-authenticate.
          </p>
        </div>

        {error && (
          <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end space-x-2 pt-2">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-3.5 py-1.5 text-xs font-semibold text-[#4A443F] bg-[#EAE5DD] hover:bg-[#DFD8CE] rounded-lg disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className={`px-4 py-1.5 text-xs font-semibold text-white rounded-lg disabled:opacity-50 cursor-pointer flex items-center space-x-1.5 ${
              isGranting ? 'bg-amber-700 hover:bg-amber-800' : 'bg-rose-600 hover:bg-rose-700'
            }`}
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Updating...</span>
              </>
            ) : (
              <span>Confirm Role Change</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export interface AdminPageProps {
  onStartReflection?: () => void;
}

export const Admin: React.FC<AdminPageProps> = () => {
  const { user } = useAuth();

  const [stats, setStats] = useState<AdminStatsResponse | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUid, setCopiedUid] = useState<string | null>(null);

  // Role modification modal state
  const [targetUser, setTargetUser] = useState<AdminUserSummary | null>(null);
  const [newRole, setNewRole] = useState<UserRole | null>(null);
  const [isUpdatingRole, setIsUpdatingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  // Success toast message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [statsRes, usersRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.listUsers({ limit: 50 }),
      ]);
      setStats(statsRes);
      setUsers(usersRes.items);
      setNextCursor(usersRes.nextCursor);
    } catch (err) {
      setError(describeError(err, 'Failed to load administration telemetry and directory.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMoreUsers = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const usersRes = await adminApi.listUsers({ cursor: nextCursor, limit: 50 });
      setUsers((prev) => [...prev, ...usersRes.items]);
      setNextCursor(usersRes.nextCursor);
    } catch (err) {
      setError(describeError(err, 'Failed to load more users.'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextCursor, isLoadingMore]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopyUid = (uid: string) => {
    navigator.clipboard.writeText(uid).then(() => {
      setCopiedUid(uid);
      setTimeout(() => setCopiedUid(null), 2000);
    });
  };

  const initiateRoleChange = (item: AdminUserSummary) => {
    if (user && item.uid === user.uid) {
      return; // Anti-self-demotion prevented in UI
    }
    const nextTargetRole: UserRole = item.role === 'admin' ? 'user' : 'admin';
    setTargetUser(item);
    setNewRole(nextTargetRole);
    setRoleError(null);
  };

  const confirmRoleChange = async () => {
    if (!targetUser || !newRole) return;
    setIsUpdatingRole(true);
    setRoleError(null);
    try {
      await adminApi.setUserRole(targetUser.uid, newRole);
      // Update local state display mirror
      setUsers((prev) =>
        prev.map((u) => (u.uid === targetUser.uid ? { ...u, role: newRole } : u))
      );
      setToastMessage(
        `Successfully changed role for ${targetUser.uid} to ${newRole}. Session tokens revoked.`
      );
      setTimeout(() => setToastMessage(null), 5000);
      setTargetUser(null);
      setNewRole(null);
    } catch (err) {
      setRoleError(describeError(err, 'Failed to update user role.'));
    } finally {
      setIsUpdatingRole(false);
    }
  };

  // Prepare chart data for unsuppressed distribution
  const chartDistribution = React.useMemo(() => {
    if (!stats || stats.suppressed || !stats.moodDistribution) return [];
    return Object.entries(stats.moodDistribution)
      .filter(([_, count]) => count > 0)
      .map(([mood, count]) => ({
        mood: mood as Mood,
        count,
      }));
  }, [stats]);

  return (
    <div className="flex-1 overflow-y-auto bg-[#F5F2ED] p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Toast banner */}
      {toastMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-2xl p-4 shadow-sm flex items-center justify-between animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center space-x-2 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{toastMessage}</span>
          </div>
          <button
            onClick={() => setToastMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1 rounded-md hover:bg-emerald-100 transition-colors cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Governance Badges */}
      <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-800 text-[#FAF8F5] flex items-center justify-center shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold font-serif text-[#4A443F]">
              RBAC Administration & Population Insights
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
              Admin Console
            </span>
          </div>
          <p className="text-xs text-[#7D756D] max-w-2xl">
            Privacy-preserving aggregate telemetry and role delegation. Engineered with zero-content
            read access, small-sample suppression, and cryptographic claim enforcement.
          </p>
        </div>

        {/* Security Governance Badges + Refresh */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              title="Identity and permissions are verified server-side via Firebase custom claims"
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#EFECE6] text-[#4A443F] border border-[#DCD3C6]"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Custom Claims RBAC</span>
            </span>
            <span
              title="Admin APIs and Firestore rules strictly prohibit reading user journal text, summaries, or locations"
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#EFECE6] text-[#4A443F] border border-[#DCD3C6]"
            >
              <EyeOff className="w-3.5 h-3.5 text-indigo-600" />
              <span>Zero-Content Access</span>
            </span>
            <span
              title="All administrative actions are written to an immutable server-side audit log"
              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[#EFECE6] text-[#4A443F] border border-[#DCD3C6]"
            >
              <History className="w-3.5 h-3.5 text-amber-600" />
              <span>Audit Trail</span>
            </span>
          </div>

          <button
            onClick={() => void loadData()}
            title="Refresh Telemetry"
            disabled={isLoading}
            className="p-2 bg-[#EFECE6] hover:bg-[#E6E1D8] text-[#5A5A40] rounded-xl border border-[#DCD3C6] transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="space-y-6 animate-pulse">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-28 bg-[#EAE5DD] rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-72 bg-[#EAE5DD] rounded-2xl" />
            <div className="h-72 bg-[#EAE5DD] rounded-2xl" />
          </div>
          <div className="h-80 bg-[#EAE5DD] rounded-2xl" />
        </div>
      )}

      {/* Error Alert Banner */}
      {!isLoading && error && (
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
          <h3 className="text-sm font-bold text-rose-900">Failed to load administration view</h3>
          <p className="text-xs text-rose-700 max-w-md mx-auto">{error}</p>
          <button
            onClick={() => void loadData()}
            className="px-4 py-2 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 cursor-pointer transition-colors"
          >
            Retry Loading
          </button>
        </div>
      )}

      {/* Main Admin Content */}
      {!isLoading && !error && stats && (
        <div className="space-y-6">
          {/* 4 KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Total Population Entries */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Population Reflections</span>
                <BookOpen className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="text-2xl font-bold font-serif text-[#4A443F]">
                {stats.totalEntries.toLocaleString()}
              </div>
              <p className="text-[11px] text-[#8C827A]">Cumulative entries across platform</p>
            </div>

            {/* Card 2: Daily Active Users */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Active Users</span>
                <Users className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="text-2xl font-bold font-serif text-[#4A443F]">
                {stats.activeUsers.toLocaleString()}
              </div>
              <p className="text-[11px] text-[#8C827A]">Users active in recent timeframe</p>
            </div>

            {/* Card 3: Population Avg Mood Score */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Population Avg Sentiment</span>
                <TrendingUp className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="flex items-baseline space-x-2">
                {stats.suppressed || stats.averageMoodScore === null ? (
                  <span className="text-base font-semibold text-[#8C827A] italic">
                    Suppressed (&lt; 5 users)
                  </span>
                ) : (
                  <>
                    <span className="text-2xl font-bold font-serif text-[#4A443F]">
                      {stats.averageMoodScore > 0
                        ? `+${stats.averageMoodScore}`
                        : stats.averageMoodScore}
                    </span>
                    <span className="text-xs text-[#8C827A]">/ 5.0</span>
                  </>
                )}
              </div>
              {!stats.suppressed && stats.averageMoodScore !== null && (
                <div className="w-full bg-[#EAE5DD] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-700 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(0, ((stats.averageMoodScore + 5) / 10) * 100)
                      )}%`,
                    }}
                  />
                </div>
              )}
              {stats.suppressed && (
                <p className="text-[11px] text-amber-800">Protected by k-anonymity policy</p>
              )}
            </div>

            {/* Card 4: Registered Directory Accounts */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-4 shadow-2xs space-y-1">
              <div className="flex items-center justify-between text-[#7D756D]">
                <span className="text-xs font-medium">Registered Accounts</span>
                <UserCheck className="w-4 h-4 text-[#5A5A40]" />
              </div>
              <div className="text-2xl font-bold font-serif text-[#4A443F]">
                {users.length.toLocaleString()}
              </div>
              <p className="text-[11px] text-[#8C827A]">Accounts in user directory</p>
            </div>
          </div>

          {/* Telemetry Row: Population Activity Trend + Mood Distribution / Privacy Card */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart 1: Population Daily Activity Trend */}
            <div className="lg:col-span-2 bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <Activity className="w-4 h-4 text-[#5A5A40]" />
                    <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                      Population Activity & Ingestion Volume
                    </h3>
                  </div>
                  <p className="text-[11px] text-[#7D756D]">
                    Daily de-identified reflection counts across all registered users
                  </p>
                </div>
              </div>

              {stats.dailyTrend.length === 0 ? (
                <div className="h-60 flex items-center justify-center text-xs text-[#8C827A] italic">
                  No activity recorded in the aggregation window.
                </div>
              ) : (
                <div className="h-60 sm:h-64 w-full pt-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={stats.dailyTrend}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="adminTrendGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8A6534" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#8A6534" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EFECE6" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#7D756D' }}
                        tickLine={false}
                        axisLine={{ stroke: '#DCD3C6' }}
                        tickFormatter={(d: string) => d.slice(5)}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 10, fill: '#7D756D' }}
                        tickLine={false}
                        axisLine={{ stroke: '#DCD3C6' }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || !payload.length) return null;
                          const point = payload[0].payload as AdminStatsResponse['dailyTrend'][0];
                          return (
                            <div className="bg-[#FAF8F5] border border-[#DCD3C6] rounded-xl p-3 shadow-lg text-xs space-y-1">
                              <div className="font-bold text-[#4A443F] border-b border-[#E2DDD5] pb-1">
                                {point.date}
                              </div>
                              <div className="flex justify-between space-x-4 text-[11px]">
                                <span className="text-[#7D756D]">Reflections:</span>
                                <span className="font-bold text-[#4A443F]">{point.entries}</span>
                              </div>
                              <div className="flex justify-between space-x-4 text-[11px]">
                                <span className="text-[#7D756D]">Active Users:</span>
                                <span className="font-bold text-[#4A443F]">{point.activeUsers}</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="entries"
                        name="Reflections"
                        stroke="#8A6534"
                        strokeWidth={2}
                        fillOpacity={1}
                        fill="url(#adminTrendGradient)"
                        dot={{ fill: '#8A6534', r: 3 }}
                        activeDot={{ r: 5, fill: '#644721' }}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Chart 2 / Privacy Card: Population Mood Distribution */}
            <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-1.5">
                  <PieIcon className="w-4 h-4 text-[#5A5A40]" />
                  <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                    Population Mood Distribution
                  </h3>
                </div>
                <p className="text-[11px] text-[#7D756D]">
                  Aggregated sentiment classification across platform
                </p>
              </div>

              {/* Privacy Preservation Notice Card (< 5 active users) */}
              {stats.suppressed || stats.activeUsers < 5 || !stats.moodDistribution ? (
                <div
                  id="privacy-suppression-card"
                  className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-5 text-center space-y-3 my-auto shadow-2xs"
                >
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center mx-auto shadow-2xs">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                      Population Distribution Suppressed for Privacy
                    </h4>
                    <p className="text-[11px] text-amber-900/90 leading-relaxed max-w-xs mx-auto">
                      Sample size insufficient (&lt; 5 users) to protect individual privacy. To prevent
                      re-identification and protect personal reflections, aggregated mood distribution is withheld.
                    </p>
                  </div>
                  <div className="inline-flex items-center space-x-1 px-2.5 py-1 bg-amber-100/70 border border-amber-300/60 rounded-full text-[10px] font-semibold text-amber-900">
                    <ShieldCheck className="w-3 h-3 text-amber-700" />
                    <span>k-Anonymity Guard Active</span>
                  </div>
                </div>
              ) : (
                /* Unsuppressed Donut Chart */
                <div className="space-y-2">
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartDistribution}
                          dataKey="count"
                          nameKey="mood"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={68}
                          paddingAngle={3}
                          isAnimationActive={false}
                        >
                          {chartDistribution.map((entry) => (
                            <Cell
                              key={entry.mood}
                              fill={getMoodTheme(entry.mood).color}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const item = payload[0].payload as { mood: Mood; count: number };
                            const theme = getMoodTheme(item.mood);
                            const ThemeIcon = theme.icon;
                            const percentage = (
                              (item.count / (stats.totalEntries || 1)) *
                              100
                            ).toFixed(1);
                            return (
                              <div className="bg-[#FAF8F5] border border-[#DCD3C6] rounded-xl p-2.5 shadow-lg text-xs space-y-1">
                                <div className="flex items-center space-x-1.5 font-bold text-[#4A443F] capitalize">
                                  <ThemeIcon className="w-3.5 h-3.5 shrink-0" />
                                  <span>{theme.name}</span>
                                </div>
                                <div className="text-[11px] text-[#7D756D]">
                                  {item.count} reflections ({percentage}%)
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Legend
                          formatter={(val: Mood) => (
                            <span className="text-[10px] text-[#4A443F] capitalize font-medium">
                              {getMoodTheme(val).name}
                            </span>
                          )}
                          iconSize={8}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="pt-2 border-t border-[#E2DDD5] text-center">
                    <span className="text-[11px] text-[#8C827A]">
                      Computed over {stats.totalEntries} de-identified entries
                    </span>
                  </div>
                </div>
              )}

              <div className="text-[10px] text-[#8C827A] flex items-center justify-center space-x-1 pt-1">
                <Info className="w-3 h-3 text-[#5A5A40]" />
                <span>Zero individual diary content is accessed or stored in aggregates</span>
              </div>
            </div>
          </div>

          {/* Privacy & Governance Invariants Panel */}
          <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-3">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                Architectural Privacy Invariants & Security Guarantees
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="bg-[#F5F2ED] border border-[#E2DDD5] rounded-xl p-3 space-y-1">
                <div className="font-bold text-[#4A443F] flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Zero Content Disclosure</span>
                </div>
                <p className="text-[11px] text-[#7D756D] leading-relaxed">
                  No diary text, summaries, titles, tags, or geographic coordinates exist in administrative
                  APIs or aggregate collections.
                </p>
              </div>

              <div className="bg-[#F5F2ED] border border-[#E2DDD5] rounded-xl p-3 space-y-1">
                <div className="font-bold text-[#4A443F] flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Independent Rules Isolation</span>
                </div>
                <p className="text-[11px] text-[#7D756D] leading-relaxed">
                  Firestore security rules strictly forbid admin tokens from querying private user subtrees
                  (<code className="text-[10px]">users/&#123;uid&#125;/**</code>).
                </p>
              </div>

              <div className="bg-[#F5F2ED] border border-[#E2DDD5] rounded-xl p-3 space-y-1">
                <div className="font-bold text-[#4A443F] flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Write-Only Audit Logs</span>
                </div>
                <p className="text-[11px] text-[#7D756D] leading-relaxed">
                  All privileged views and role modifications write to <code className="text-[10px]">audit_logs</code>,
                  which is unreadable and unwritable by all clients.
                </p>
              </div>

              <div className="bg-[#F5F2ED] border border-[#E2DDD5] rounded-xl p-3 space-y-1">
                <div className="font-bold text-[#4A443F] flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Instant Revocation</span>
                </div>
                <p className="text-[11px] text-[#7D756D] leading-relaxed">
                  Role updates invoke Firebase token revocation, eliminating the 60-minute claim propagation
                  delay via server-side check.
                </p>
              </div>
            </div>
          </div>

          {/* User Directory & Role Management Table */}
          <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center space-x-2">
                  <Users className="w-4 h-4 text-[#5A5A40]" />
                  <h3 className="text-sm font-bold font-serif text-[#4A443F]">
                    User Directory & Role Delegation
                  </h3>
                </div>
                <p className="text-[11px] text-[#7D756D]">
                  Manage system privileges with cryptographic custom claims and anti-self-demotion enforcement.
                </p>
              </div>
              <span className="text-[11px] text-[#8C827A] font-medium self-start sm:self-auto">
                {users.length} {users.length === 1 ? 'user registered' : 'users registered'}
              </span>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto border border-[#E2DDD5] rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#EFECE6] border-b border-[#E2DDD5] text-[#5A5A40] font-semibold">
                    <th className="py-3 px-4">User UID</th>
                    <th className="py-3 px-4">Created</th>
                    <th className="py-3 px-4">Last Active</th>
                    <th className="py-3 px-4 text-center">Reflections</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2DDD5] bg-[#FAF8F5]">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-xs text-[#8C827A] italic">
                        No registered users found in the directory.
                      </td>
                    </tr>
                  ) : (
                    users.map((item) => {
                      const isSelf = Boolean(user && item.uid === user.uid);
                      const isAdmin = item.role === 'admin';
                      const createdDate = new Date(item.createdAt);
                      const lastActiveDate = item.lastActiveAt ? new Date(item.lastActiveAt) : null;

                      return (
                        <tr
                          key={item.uid}
                          className={`hover:bg-[#F5F2ED] transition-colors ${
                            isSelf ? 'bg-amber-50/30' : ''
                          }`}
                        >
                          {/* User UID */}
                          <td className="py-3 px-4">
                            <div className="flex items-center space-x-2.5">
                              <div className="w-7 h-7 rounded-full bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center font-bold text-[10px] shrink-0">
                                <UserIcon className="w-3.5 h-3.5" />
                              </div>
                              <div className="flex items-center space-x-1.5 min-w-0">
                                <span className="font-mono text-xs text-[#4A443F] bg-[#EFECE6] px-2 py-0.5 rounded border border-[#DCD3C6] truncate">
                                  {item.uid}
                                </span>
                                {isSelf && (
                                  <span className="text-[10px] font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded shrink-0">
                                    You
                                  </span>
                                )}
                                <button
                                  onClick={() => handleCopyUid(item.uid)}
                                  title="Copy Full UID"
                                  className="p-1 text-[#8C827A] hover:text-[#4A443F] rounded transition-colors cursor-pointer shrink-0"
                                >
                                  {copiedUid === item.uid ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </td>

                          {/* Created Date */}
                          <td className="py-3 px-4 text-[#7D756D]">
                            <div className="flex items-center space-x-1 text-[11px]">
                              <Calendar className="w-3.5 h-3.5 text-[#8C827A]" />
                              <span>
                                {!Number.isNaN(createdDate.getTime())
                                  ? createdDate.toLocaleDateString()
                                  : item.createdAt}
                              </span>
                            </div>
                          </td>

                          {/* Last Active */}
                          <td className="py-3 px-4 text-[#7D756D]">
                            <div className="flex items-center space-x-1 text-[11px]">
                              <Clock className="w-3.5 h-3.5 text-[#8C827A]" />
                              <span>
                                {lastActiveDate && !Number.isNaN(lastActiveDate.getTime())
                                  ? lastActiveDate.toLocaleDateString()
                                  : item.lastActiveAt || 'Never'}
                              </span>
                            </div>
                          </td>

                          {/* Entry Count */}
                          <td className="py-3 px-4 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#EFECE6] text-[#5A5A40]">
                              {item.entryCount}
                            </span>
                          </td>

                          {/* Role Badge */}
                          <td className="py-3 px-4">
                            {isAdmin ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                <ShieldAlert className="w-3 h-3 mr-1 text-amber-700" />
                                Admin
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EFECE6] text-[#7D756D] border border-[#DCD3C6]">
                                <UserIcon className="w-3 h-3 mr-1 text-[#7D756D] shrink-0" />
                                User
                              </span>
                            )}
                          </td>

                          {/* Action Button */}
                          <td className="py-3 px-4 text-right">
                            {isSelf ? (
                              <span
                                title="Anti-Self-Demotion Guard: Administrators cannot revoke their own admin status to prevent accidental lockout."
                                className="text-[10px] text-[#8C827A] italic cursor-not-allowed bg-[#EAE5DD] px-2 py-1 rounded"
                              >
                                Self (Protected)
                              </span>
                            ) : (
                              <button
                                onClick={() => initiateRoleChange(item)}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                                  isAdmin
                                    ? 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                                    : 'bg-amber-50 text-amber-900 hover:bg-amber-100 border border-amber-200'
                                }`}
                              >
                                {isAdmin ? 'Revoke Admin' : 'Make Admin'}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination / Load More */}
            {nextCursor && (
              <div className="text-center pt-2">
                <button
                  onClick={() => void loadMoreUsers()}
                  disabled={isLoadingMore}
                  className="px-4 py-2 bg-[#EFECE6] hover:bg-[#E6E1D8] text-[#5A5A40] rounded-xl text-xs font-semibold border border-[#DCD3C6] transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center space-x-1.5"
                >
                  {isLoadingMore ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Loading more users...</span>
                    </>
                  ) : (
                    <span>Load More Users</span>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Role Change Confirmation Modal */}
      <RoleChangeModal
        targetUser={targetUser}
        newRole={newRole}
        isSubmitting={isUpdatingRole}
        error={roleError}
        onConfirm={() => void confirmRoleChange()}
        onCancel={() => {
          setTargetUser(null);
          setNewRole(null);
          setRoleError(null);
        }}
      />
    </div>
  );
};
