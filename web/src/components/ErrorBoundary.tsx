import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * One crashing view must not white-screen the app. The message shown is deliberately plain:
 * a render error can carry component internals, and the browser console is the right place
 * for that, not the page.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Render error caught by boundary:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-[#F5F2ED] flex flex-col items-center justify-center p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-rose-600 mb-3" />
        <h2 className="text-base font-bold font-serif text-[#4A443F]">Something broke on this screen</h2>
        <p className="mt-2 text-xs text-[#7D756D] max-w-sm">
          Your saved reflections are unaffected — nothing is stored in this page. Reloading
          usually clears it.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-[#5A5A40] text-[#FAF8F5] rounded-lg text-xs font-semibold hover:bg-[#484833]"
        >
          Reload
        </button>
      </div>
    );
  }
}
