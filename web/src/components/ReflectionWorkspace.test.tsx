import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReflectionWorkspace } from './ReflectionWorkspace';
import type { SessionDoc, MessageDoc } from '@journal/shared';

const mockSession: SessionDoc = {
  id: 'sess_1',
  title: 'Morning Reflection',
  status: 'active',
  messageCount: 0,
  entryId: null,
  createdAt: '2026-09-03T08:00:00.000Z',
  updatedAt: '2026-09-03T08:00:00.000Z',
};

describe('ReflectionWorkspace Optimistic Message Rendering', () => {
  it('renders optimistic user message bubble and companion thinking state while isSending is true', () => {
    const optimisticMessage: MessageDoc = {
      id: `optimistic-${Date.now()}`,
      role: 'user',
      text: 'Exploring my thoughts on deep focus today.',
      createdAt: new Date().toISOString(),
    };

    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={mockSession}
        messages={[optimisticMessage]}
        entry={null}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={true}
        isFinalizing={false}
      />
    );

    // 1. User's optimistic message is rendered immediately
    expect(html).toContain('Exploring my thoughts on deep focus today.');
    // 2. The status indicator shows "Sending…"
    expect(html).toContain('Sending…');
    // 3. User label is present
    expect(html).toContain('You');
    // 4. Companion thinking indicator is rendered
    expect(html).toContain('Thinking it through…');
    // 5. Starter prompts are not shown since message list has the optimistic message
    expect(html).not.toContain('Suggested openers');
    // 6. Copy button is disabled/omitted for in-flight optimistic message
    expect(html).not.toContain('aria-label="Copy message text"');
  });

  it('renders confirmed messages with formatted timestamp and copy button', () => {
    const confirmedMessages: MessageDoc[] = [
      {
        id: 'msg_user_1',
        role: 'user',
        text: 'Hello from verified user',
        createdAt: '2026-09-03T10:00:00.000Z',
      },
      {
        id: 'msg_model_1',
        role: 'model',
        text: 'Hello! I am here to help you reflect.',
        createdAt: '2026-09-03T10:00:02.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={mockSession}
        messages={confirmedMessages}
        entry={null}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={false}
        isFinalizing={false}
      />
    );

    expect(html).toContain('Hello from verified user');
    expect(html).toContain('Hello! I am here to help you reflect.');
    expect(html).not.toContain('Sending…');
    expect(html).not.toContain('Thinking it through…');
    // Copy button is present for confirmed messages
    expect(html).toContain('aria-label="Copy message text"');
  });

  it('renders starter prompts when message list is empty and not sending', () => {
    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={mockSession}
        messages={[]}
        entry={null}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={false}
        isFinalizing={false}
      />
    );

    expect(html).toContain('Start your reflection');
    expect(html).toContain('Suggested openers');
    expect(html).toContain('Reflecting on a challenging decision I need to make...');
  });

  it('renders finalized entry with serif typography matching the journal theme', () => {
    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={{ ...mockSession, status: 'finalized', entryId: 'entry_1' }}
        messages={[
          { id: 'm1', role: 'user', text: 'My entry thoughts', createdAt: '2026-09-03T08:00:00.000Z' },
          { id: 'm2', role: 'model', text: 'Summary of thoughts', createdAt: '2026-09-03T08:00:02.000Z' },
        ]}
        entry={{
          id: 'entry_1',
          sessionId: 'sess_1',
          title: 'A Day of Grounded Reflection',
          summary: 'Recognized cognitive load and chose intentional pauses.',
          mood: 'calm',
          moodScore: 4,
          moodReason: 'Measured language and intentional framing.',
          tags: ['focus', 'grounding'],
          location: null,
          createdAt: '2026-09-03T08:01:00.000Z',
          updatedAt: '2026-09-03T08:01:00.000Z',
        }}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={false}
        isFinalizing={false}
      />
    );

    expect(html).toContain('A Day of Grounded Reflection');
    expect(html).toContain('font-serif');
    expect(html).toContain('Saved as entry');
    expect(html).toContain('This reflection is saved as an entry.');
  });

  it('handles invalid or empty message timestamps gracefully without displaying Invalid Date', () => {
    const invalidDateMessage: MessageDoc = {
      id: 'msg_bad_date',
      role: 'user',
      text: 'Message with unparseable date',
      createdAt: 'not-a-valid-date',
    };

    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={mockSession}
        messages={[invalidDateMessage]}
        entry={null}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={false}
        isFinalizing={false}
      />
    );

    expect(html).toContain('Message with unparseable date');
    expect(html).not.toContain('Invalid Date');
  });

  it('does not render thinking indicator when isSending is false', () => {
    const html = renderToStaticMarkup(
      <ReflectionWorkspace
        session={mockSession}
        messages={[
          {
            id: 'm1',
            role: 'user',
            text: 'Just checking in',
            createdAt: '2026-09-03T10:00:00.000Z',
          },
        ]}
        entry={null}
        isLoading={false}
        loadError={null}
        onReloadMessages={() => {}}
        onSend={async () => ({ ok: true })}
        onFinalize={async () => ({ ok: true })}
        onRequestDelete={() => {}}
        isSending={false}
        isFinalizing={false}
      />
    );

    expect(html).not.toContain('Thinking it through…');
    expect(html).toContain('Just checking in');
  });
});
