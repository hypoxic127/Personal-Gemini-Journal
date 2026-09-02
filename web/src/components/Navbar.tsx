import React from 'react';
import { Sparkles, ShieldCheck, LogOut, User as UserIcon, Plus, ShieldAlert } from 'lucide-react';
import type { User } from 'firebase/auth';

interface NavbarProps {
  user: User | null;
  role?: 'user' | 'admin';
  entryCount?: number;
  activeView?: 'workspace' | 'insights';
  onViewChange?: (view: 'workspace' | 'insights') => void;
  onSignOut: () => void;
  onNewReflection?: () => void;
  onOpenThreatModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  role = 'user',
  entryCount = 0,
  activeView = 'workspace',
  onViewChange,
  onSignOut,
  onNewReflection,
  onOpenThreatModal,
}) => {
  return (
    <header className="bg-[#FAF8F5] border-b border-[#E2DDD5] px-4 sm:px-6 py-3 sticky top-0 z-30 flex items-center justify-between shadow-2xs">
      <div className="flex items-center space-x-4 sm:space-x-6">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-[#5A5A40] flex items-center justify-center text-[#FAF8F5] shadow-xs">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-[#4A443F] font-serif tracking-tight leading-tight">Gemini Journal</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#EAE5DD] text-[#5A5A40] border border-[#DCD3C6]">
                Powered by Gemini
              </span>
              {role === 'admin' && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <ShieldAlert className="w-3 h-3 mr-1" />
                  Admin
                </span>
              )}
              {entryCount > 0 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EFECE6] text-[#7D756D] border border-[#DCD3C6]">
                  {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#7D756D] hidden sm:block">Private Journaling & Perspective Assistant</p>
          </div>
        </div>

        {/* View Mode Navigation Tabs */}
        {onViewChange && (
          <nav className="flex items-center space-x-1 bg-[#EFECE6] p-0.5 sm:p-1 rounded-xl border border-[#DCD3C6]">
            <button
              onClick={() => onViewChange('workspace')}
              className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer ${
                activeView === 'workspace'
                  ? 'bg-[#5A5A40] text-[#FAF8F5] shadow-2xs'
                  : 'text-[#7D756D] hover:text-[#4A443F]'
              }`}
            >
              Reflections
            </button>
            <button
              onClick={() => onViewChange('insights')}
              className={`px-2.5 sm:px-3 py-1 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer ${
                activeView === 'insights'
                  ? 'bg-[#5A5A40] text-[#FAF8F5] shadow-2xs'
                  : 'text-[#7D756D] hover:text-[#4A443F]'
              }`}
            >
              Mood Insights
            </button>
          </nav>
        )}
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3">
        {onNewReflection && (
          <button
            id="new-reflection-btn"
            onClick={() => {
              if (onViewChange) onViewChange('workspace');
              onNewReflection();
            }}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#5A5A40] hover:bg-[#484833] text-[#FAF8F5] rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
        )}

        <button
          id="nav-threat-modal-btn"
          onClick={onOpenThreatModal}
          title="Inspect Security & Threat Model"
          className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-[#EFECE6] hover:bg-[#E6E1D8] text-[#4A443F] border border-[#DCD3C6] rounded-lg text-xs font-medium transition-colors cursor-pointer"
        >
          <ShieldCheck className="w-4 h-4 text-[#5A5A40]" />
          <span>Security Model</span>
        </button>

        <div className="h-6 w-px bg-[#E2DDD5] hidden sm:block" />

        {/* User Info & Sign Out */}
        <div className="flex items-center space-x-2">
          {user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="w-8 h-8 rounded-full border border-[#DCD3C6]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#EAE5DD] text-[#5A5A40] flex items-center justify-center font-bold text-xs">
              <UserIcon className="w-4 h-4" />
            </div>
          )}

          <div className="text-left hidden lg:block">
            <span className="block text-xs font-semibold text-[#4A443F] leading-none">
              {user?.displayName || 'Authenticated User'}
            </span>
            <span className="block text-[10px] text-[#8C827A] font-mono truncate max-w-[150px]">
              {user?.email}
            </span>
          </div>

          <button
            id="signout-btn"
            onClick={onSignOut}
            title="Sign Out"
            className="p-1.5 text-[#8C827A] hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};