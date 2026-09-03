import React from 'react';
import {
  ShieldCheck,
  Sparkles,
  Lock,
  Cloud,
  ArrowRight,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  isLoading: boolean;
  onOpenThreatModal: () => void;
  authError?: string | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onSignIn,
  isLoading,
  onOpenThreatModal,
  authError,
}) => {
  return (
    <div className="min-h-screen min-h-dvh bg-[#F5F2ED] text-[#4A443F] flex flex-col justify-between">
      {/* Top Navbar */}
      <header className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-3.5 sm:py-5 flex items-center justify-between border-b border-[#E2DDD5] gap-2 sm:gap-3">
        <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
          <div className="w-9 sm:w-10 h-9 sm:h-10 rounded-xl bg-[#EAE5DD] border border-[#DCD3C6] flex items-center justify-center text-[#5A5A40] shrink-0 shadow-sm">
            <Sparkles className="w-4 sm:w-5 h-4 sm:h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="text-sm sm:text-lg font-bold font-serif tracking-tight text-[#4A443F] block leading-tight truncate sm:overflow-visible">
              Gemini Reflection Journal
            </span>
            <span className="block text-[10px] sm:text-[11px] text-[#7D756D] font-medium mt-0.5 truncate sm:overflow-visible">
              Powered by Gemini &amp; Cloud Firestore
            </span>
          </div>
        </div>

        <button
          type="button"
          id="landing-threat-model-btn"
          onClick={onOpenThreatModal}
          aria-haspopup="dialog"
          aria-label="Threat Model & Security Spec"
          title="Threat Model & Security Spec"
          className="flex items-center space-x-1.5 sm:space-x-2 text-[11px] sm:text-xs font-semibold px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-[#FAF8F5] hover:bg-[#EFECE6] active:bg-[#E5E0D6] border border-[#DCD3C6] text-[#4A443F] shadow-sm hover:shadow active:shadow-inner focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5A5A40] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F2ED] transition-all duration-200 cursor-pointer shrink-0"
        >
          <ShieldCheck className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-[#5A5A40] shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">Threat Model &amp; Security Spec</span>
          <span className="sm:hidden">Threat Model</span>
        </button>
      </header>

      {/* Hero Section */}
      <main className="max-w-5xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 flex-1 flex flex-col items-center justify-center text-center">
        <div className="inline-flex items-center space-x-2 px-3 sm:px-4 py-1.5 rounded-full bg-[#EAE5DD] border border-[#DCD3C6] text-[#5A5A40] text-[10px] sm:text-xs font-semibold mb-6 tracking-normal sm:tracking-wide max-w-full text-center">
          <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="leading-snug">Intelligent Multi-Turn Journaling &amp; Perspective Assistant</span>
        </div>

        <h1 className="text-3xl sm:text-5xl lg:text-6xl font-serif font-medium tracking-tight text-[#4A443F] max-w-3xl leading-[1.2] sm:leading-[1.15]">
          A Private Space for Deep Reflections with <span className="text-[#5A5A40] italic font-serif">Gemini</span>
        </h1>

        <p className="mt-5 sm:mt-6 text-sm sm:text-base md:text-lg text-[#7D756D] max-w-2xl font-normal leading-relaxed">
          Write thoughts, brainstorm decisions, and gain clarity through intelligent AI dialogue. All reflections are securely stored in Cloud Firestore, strictly isolated to your verified identity.
        </p>

        {authError && (
          <div className="mt-6 max-w-md w-full p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs text-left flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <span className="font-semibold block mb-1">Authentication Notice:</span>
              <p>{authError}</p>
            </div>
          </div>
        )}

        {/* Primary Call to Action */}
        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
          <button
            type="button"
            id="google-signin-btn"
            onClick={onSignIn}
            disabled={isLoading}
            className="w-full sm:w-auto px-8 py-3.5 sm:py-4 bg-[#5A5A40] hover:bg-[#484833] active:bg-[#3D3D2B] text-[#FAF8F5] font-semibold rounded-xl text-sm sm:text-base shadow-sm hover:shadow-md active:shadow-inner transition-all duration-200 ease-out flex items-center justify-center space-x-3 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-[#5A5A40] disabled:active:bg-[#5A5A40] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5A5A40] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F5F2ED] cursor-pointer"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-[#FAF8F5] border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            ) : (
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#EA4335"
                  d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.5 1.9 7.1l3.7 2.8C6.5 7.1 9 5 12 5z"
                />
                <path
                  fill="#4285F4"
                  d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.6 14.1c-.2-.7-.4-1.4-.4-2.1s.2-1.4.4-2.1L1.9 7.1C.7 9.5 0 12.2 0 15s.7 5.5 1.9 7.9l3.7-2.8c-.2-.7-.4-1.4-.4-2.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.1-6.4-4.9L1.9 16.2C3.7 19.8 7.5 23 12 23z"
                />
              </svg>
            )}
            <span>{isLoading ? 'Connecting...' : 'Sign in with Google'}</span>
            {!isLoading && <ArrowRight className="w-4 h-4 text-[#DCD3C6] shrink-0" aria-hidden="true" />}
          </button>
        </div>

        {/* 3 Pillars / Feature Grid */}
        <div className="mt-14 sm:mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 text-left max-w-4xl w-full items-stretch">
          <div className="flex flex-col h-full p-6 sm:p-7 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD5] shadow-sm hover:shadow-md hover:border-[#DCD3C6] transition-all duration-200">
            <div className="w-11 h-11 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6] shadow-sm shrink-0">
              <MessageSquare className="w-5 h-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-bold font-serif text-[#4A443F] mb-2">Multi-Turn AI Reflections</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed flex-1">
              Explore your thoughts with Gemini. Brainstorm options, gain new angles, and receive deep structured summaries.
            </p>
          </div>

          <div className="flex flex-col h-full p-6 sm:p-7 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD5] shadow-sm hover:shadow-md hover:border-[#DCD3C6] transition-all duration-200">
            <div className="w-11 h-11 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6] shadow-sm shrink-0">
              <Lock className="w-5 h-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-bold font-serif text-[#4A443F] mb-2">Strict User Isolation</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed flex-1">
              Stored under <code className="text-[#5A5A40] bg-[#EAE5DD] px-1.5 py-0.5 rounded font-mono text-[11px] whitespace-nowrap">/users/{'{uid}'}/entries</code> in Cloud Firestore. No other user can access your logs.
            </p>
          </div>

          <div className="flex flex-col h-full p-6 sm:p-7 rounded-2xl bg-[#FAF8F5] border border-[#E2DDD5] shadow-sm hover:shadow-md hover:border-[#DCD3C6] transition-all duration-200">
            <div className="w-11 h-11 rounded-xl bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center mb-4 border border-[#DCD3C6] shadow-sm shrink-0">
              <Cloud className="w-5 h-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-bold font-serif text-[#4A443F] mb-2">Zero-Exposure Security</h3>
            <p className="text-xs text-[#7D756D] leading-relaxed flex-1">
              Gemini API keys stay protected on the server side with automated fallback resiliency across 4 model tiers.
            </p>
          </div>
        </div>

        {/* Trust Badges */}
        <div className="mt-10 sm:mt-12 inline-flex flex-col sm:flex-row items-start sm:items-center justify-center gap-3 sm:gap-6 text-xs text-[#7D756D]">
          <div className="flex items-center space-x-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4 text-[#5A5A40] shrink-0" aria-hidden="true" />
            <span>Google Federated Identity</span>
          </div>
          <div className="flex items-center space-x-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4 text-[#5A5A40] shrink-0" aria-hidden="true" />
            <span>Firestore Rules Enforced</span>
          </div>
          <div className="flex items-center space-x-1.5 font-medium">
            <CheckCircle2 className="w-4 h-4 text-[#5A5A40] shrink-0" aria-hidden="true" />
            <span>Zero-Hardcoding Hygiene</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 border-t border-[#E2DDD5] flex flex-col md:flex-row items-center justify-between text-xs text-[#7D756D] gap-4">
        <span className="text-center md:text-left">
          © 2026 Gemini Reflection Journal. All data isolated to your verified identity.
        </span>
        <div
          role="list"
          aria-label="Architectural security assurances"
          className="flex flex-wrap items-center justify-center md:justify-end gap-2 text-[11px]"
        >
          <span role="listitem" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF8F5] border border-[#E2DDD5] font-medium shadow-sm text-[#7D756D] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40]/70 shrink-0" aria-hidden="true" />
            Serverless on Cloud Run
          </span>
          <span role="listitem" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF8F5] border border-[#E2DDD5] font-medium shadow-sm text-[#7D756D] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40]/70 shrink-0" aria-hidden="true" />
            Zero Direct Client Writes
          </span>
          <span role="listitem" className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF8F5] border border-[#E2DDD5] font-medium shadow-sm text-[#7D756D] whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5A5A40]/70 shrink-0" aria-hidden="true" />
            App Check &amp; Rules Protected
          </span>
        </div>
      </footer>
    </div>
  );
};