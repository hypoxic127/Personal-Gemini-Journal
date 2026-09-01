import React from 'react';

export const App: React.FC = () => {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8 text-center border border-slate-100">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Personal Gemini Journal</h1>
        <p className="text-slate-600 mb-6">Secure AI-powered reflective journal</p>
        <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium border border-emerald-200">
          M0 Scaffold Ready
        </div>
      </div>
    </main>
  );
};