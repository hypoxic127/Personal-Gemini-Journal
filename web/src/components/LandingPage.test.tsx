import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './LandingPage';

// Helper to find a React element with specific id in a React element tree
function findElementById(node: any, id: string): any {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.id === id) return node;
  if (Array.isArray(node.props?.children)) {
    for (const child of node.props.children) {
      const found = findElementById(child, id);
      if (found) return found;
    }
  } else if (node.props?.children) {
    return findElementById(node.props.children, id);
  }
  return null;
}

describe('LandingPage Component', () => {
  it('renders sole authoritative Threat Model button in header and invokes onOpenThreatModal when clicked', () => {
    const onOpenThreatModal = vi.fn();
    const onSignIn = vi.fn();

    const element = LandingPage({
      onSignIn,
      isLoading: false,
      onOpenThreatModal,
    });

    const threatBtn = findElementById(element, 'landing-threat-model-btn');
    expect(threatBtn).toBeDefined();
    expect(threatBtn.props.id).toBe('landing-threat-model-btn');
    expect(threatBtn.props.type).toBe('button');
    expect(threatBtn.props['aria-label']).toBe('Threat Model & Security Spec');
    expect(threatBtn.props.title).toBe('Threat Model & Security Spec');
    expect(threatBtn.props['aria-haspopup']).toBe('dialog');

    // Simulate click
    threatBtn.props.onClick();
    expect(onOpenThreatModal).toHaveBeenCalledTimes(1);

    // Verify static HTML
    const html = renderToStaticMarkup(
      <LandingPage
        onSignIn={onSignIn}
        isLoading={false}
        onOpenThreatModal={onOpenThreatModal}
      />
    );

    // Threat model trigger in header
    expect(html).toContain('id="landing-threat-model-btn"');
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Threat Model &amp; Security Spec"');
    expect(html).toContain('title="Threat Model &amp; Security Spec"');
    expect(html).toContain('Threat Model &amp; Security Spec');
    expect(html).toContain('Threat Model');

    // Check count of landing-threat-model-btn occurrences
    const matches = html.match(/id="landing-threat-model-btn"/g);
    expect(matches).toHaveLength(1);

    // Verify dynamic viewport height and responsive container classes
    expect(html).toContain('min-h-dvh');
    expect(html).toContain('w-9 sm:w-10 h-9 sm:h-10');
    expect(html).toContain('text-sm sm:text-lg');
  });

  it('removes duplicate threat model modal trigger from footer and renders architectural assurances', () => {
    const html = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
      />
    );

    // Former duplicate footer button text must not exist
    expect(html).not.toContain('View OWASP &amp; Agentic Threat Model');
    expect(html).not.toContain('View OWASP & Agentic Threat Model');

    // Ensure footer has ZERO button elements
    const footerStart = html.indexOf('<footer');
    const footerEnd = html.indexOf('</footer>');
    expect(footerStart).toBeGreaterThan(-1);
    expect(footerEnd).toBeGreaterThan(footerStart);
    const footerHtml = html.slice(footerStart, footerEnd);
    expect(footerHtml).not.toContain('<button');

    // Footer contains privacy guarantee
    expect(html).toContain('© 2026 Gemini Reflection Journal. All data isolated to your verified identity.');

    // Footer contains architectural badges with semantic list roles
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-label="Architectural security assurances"');
    expect(html).toContain('role="listitem"');
    expect(html).toContain('Serverless on Cloud Run');
    expect(html).toContain('Zero Direct Client Writes');
    expect(html).toContain('App Check &amp; Rules Protected');
    expect(html).toContain('whitespace-nowrap');
  });

  it('renders Google sign-in button and triggers onSignIn on click', () => {
    const onSignIn = vi.fn();
    const element = LandingPage({
      onSignIn,
      isLoading: false,
      onOpenThreatModal: () => {},
    });

    const signInBtn = findElementById(element, 'google-signin-btn');
    expect(signInBtn).toBeDefined();
    signInBtn.props.onClick();
    expect(onSignIn).toHaveBeenCalledTimes(1);

    const html = renderToStaticMarkup(
      <LandingPage
        onSignIn={onSignIn}
        isLoading={false}
        onOpenThreatModal={() => {}}
      />
    );
    expect(html).toContain('id="google-signin-btn"');
    expect(html).toContain('type="button"');
    expect(html).toContain('Sign in with Google');
    expect(html).not.toContain('Connecting...');
  });

  it('shows loading state and disables button when isLoading is true', () => {
    const loadingElement = LandingPage({
      onSignIn: () => {},
      isLoading: true,
      onOpenThreatModal: () => {},
    });
    const loadingBtn = findElementById(loadingElement, 'google-signin-btn');
    expect(loadingBtn.props.disabled).toBe(true);

    const html = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={true}
        onOpenThreatModal={() => {}}
      />
    );

    expect(html).toContain('Connecting...');
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Sign in with Google');
  });

  it('displays authentication error notice when authError is provided and hides when falsy', () => {
    const errorHtml = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
        authError="Popup blocked by client browser."
      />
    );

    expect(errorHtml).toContain('Authentication Notice:');
    expect(errorHtml).toContain('Popup blocked by client browser.');

    const nullHtml = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
        authError={null}
      />
    );
    expect(nullHtml).not.toContain('Authentication Notice:');

    const emptyHtml = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
        authError=""
      />
    );
    expect(emptyHtml).not.toContain('Authentication Notice:');

    const undefinedHtml = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
        authError={undefined}
      />
    );
    expect(undefinedHtml).not.toContain('Authentication Notice:');
  });

  it('renders three core feature pillars with paper journal theme tokens and protected code path', () => {
    const html = renderToStaticMarkup(
      <LandingPage
        onSignIn={() => {}}
        isLoading={false}
        onOpenThreatModal={() => {}}
      />
    );

    expect(html).toContain('Multi-Turn AI Reflections');
    expect(html).toContain('Strict User Isolation');
    expect(html).toContain('Zero-Exposure Security');
    expect(html).toContain('/users/{uid}/entries');
    expect(html).toContain('whitespace-nowrap');
    expect(html).not.toContain('break-all');
    expect(html).toContain('Google Federated Identity');
    expect(html).toContain('Firestore Rules Enforced');
    expect(html).toContain('Zero-Hardcoding Hygiene');
  });
});
