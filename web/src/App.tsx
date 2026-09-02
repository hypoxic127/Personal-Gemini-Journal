import React, { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { ThreatSummaryTable } from './components/ThreatSummaryTable';
import { ShieldCheck, BookOpen, Clock, KeyRound } from 'lucide-react';

const Dashboard: React.FC<{ onOpenThreatModal: () => void }> = ({ onOpenThreatModal }) => {
  const { user, profile, role, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-[#F5F2ED] flex flex-col">
      <Navbar
        user={user}
        role={role}
        entryCount={profile?.entryCount || 0}
        onSignOut={signOut}
        onOpenThreatModal={onOpenThreatModal}
      />

      <main className="max-w-5xl mx-auto w-full px-6 py-10 flex-1 space-y-8">
        {/* Welcome Banner */}
        <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-6 sm:p-8 shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-[#EAE5DD] text-[#5A5A40] text-xs font-semibold mb-3">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>M1 · Authenticated & Data-Isolated Base</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold font-serif text-[#4A443F]">
                Welcome back, {user?.displayName || 'Reflector'}
              </h2>
              <p className="text-sm text-[#7D756D] mt-1">
                Your authenticated session is cryptographically bound to UID: <code className="bg-[#EAE5DD] text-[#5A5A40] px-1.5 py-0.5 rounded font-mono text-xs">{user?.uid}</code>
              </p>
            </div>

            <div className="flex sm:flex-col items-start sm:items-end justify-between border-t sm:border-t-0 pt-3 sm:pt-0 border-[#E2DDD5]">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                role === 'admin' ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              }`}>
                {role === 'admin' ? 'Administrator' : 'Standard User'}
              </span>
            </div>
          </div>
        </div>

        {/* Security & User Profile Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-6 shadow-2xs space-y-3">
            <div className="w-9 h-9 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#4A443F]">Firebase Auth</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed">
              Google Federated OAuth with server-side token validation (<code className="font-mono text-[11px]">checkRevoked: true</code>).
            </p>
          </div>

          <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-6 shadow-2xs space-y-3">
            <div className="w-9 h-9 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#4A443F]">Entries Isolation</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed">
              Current Entry Count: <strong className="text-[#4A443F] font-bold">{profile?.entryCount ?? 0}</strong>. All entries are written strictly via Cloud Run backend Admin SDK.
            </p>
          </div>

          <div className="bg-[#FAF8F5] border border-[#E2DDD5] rounded-2xl p-6 shadow-2xs space-y-3">
            <div className="w-9 h-9 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#4A443F]">Activity Sync</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed">
              Last synced at: <span className="font-mono text-[11px] text-[#4A443F]">{profile?.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleString() : 'Just now'}</span>
            </p>
          </div>
        </div>

        {/* Milestone Next Steps Indicator */}
        <div className="bg-[#EAE5DD]/60 border border-[#DCD3C6] rounded-2xl p-6 text-center space-y-3">
          <h4 className="text-sm font-bold text-[#4A443F]">M1 Grounding Complete & Verified</h4>
          <p className="text-xs text-[#7D756D] max-w-xl mx-auto">
            Ready to proceed to M2 (Interactive Multi-Turn Dialogue with Gemini 3.6 Flash and resilient 4-tier model fallback ladder).
          </p>
        </div>
      </main>
    </div>
  );
};

const AppContent: React.FC = () => {
  const { user, isLoading, authError, signInWithGoogle } = useAuth();
  const [isThreatModalOpen, setIsThreatModalOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F5F2ED] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-8 h-8 border-3 border-[#5A5A40] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-[#7D756D] font-medium">Verifying authentication session...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      {!user ? (
        <LandingPage
          onSignIn={signInWithGoogle}
          isLoading={isLoading}
          onOpenThreatModal={() => setIsThreatModalOpen(true)}
          authError={authError}
        />
      ) : (
        <Dashboard onOpenThreatModal={() => setIsThreatModalOpen(true)} />
      )}

      <ThreatSummaryTable
        isOpen={isThreatModalOpen}
        onClose={() => setIsThreatModalOpen(false)}
      />
    </>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};