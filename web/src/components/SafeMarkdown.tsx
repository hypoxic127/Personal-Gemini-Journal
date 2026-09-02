import React from 'react';

/**
 * A deliberately small Markdown renderer for model output.
 *
 * Model replies are untrusted text. This builds React elements only — there is no HTML
 * string anywhere in this file, so React's raw-HTML escape hatch (forbidden by AGENTS.md,
 * and by the security gate, which greps for it) is not merely avoided: it has nothing to be
 * applied to. React escapes every text node it renders, so the worst a malicious reply can
 * do is look odd.
 *
 * The supported subset is the allow-list: headings, bullet and numbered lists, paragraphs,
 * and inline bold / italic / code. Anything else renders as its own literal text. Links are
 * deliberately NOT rendered as anchors — a model-authored URL is exactly the thing not to
 * make one click away.
 */

type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

const parseInline = (text: string): Inline[] =>
  text
    .split(INLINE_PATTERN)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return { text: part.slice(2, -2), bold: true };
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return { text: part.slice(1, -1), italic: true };
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return { text: part.slice(1, -1), code: true };
      }
      return { text: part };
    });

const renderInline = (text: string, keyPrefix: string): React.ReactNode[] =>
  parseInline(text).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.code) {
      return (
        <code key={key} className="px-1 py-0.5 rounded bg-[#EAE5DD] text-[#4A443F] font-mono text-[0.9em]">
          {piece.text}
        </code>
      );
    }
    if (piece.bold) return <strong key={key} className="font-semibold">{piece.text}</strong>;
    if (piece.italic) return <em key={key}>{piece.text}</em>;
    return <React.Fragment key={key}>{piece.text}</React.Fragment>;
  });

const isBullet = (line: string) => /^\s*[-*+]\s+/.test(line);
const isNumbered = (line: string) => /^\s*\d+[.)]\s+/.test(line);
const stripMarker = (line: string) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');

export const SafeMarkdown: React.FC<{ text: string }> = ({ text }) => {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/);

  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n').filter((line) => line.trim().length > 0);
        if (lines.length === 0) return null;
        const key = `b${blockIndex}`;

        if (lines.every(isBullet)) {
          return (
            <ul key={key} className="list-disc pl-5 space-y-1">
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(stripMarker(line), `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        if (lines.every(isNumbered)) {
          return (
            <ol key={key} className="list-decimal pl-5 space-y-1">
              {lines.map((line, i) => (
                <li key={`${key}-${i}`}>{renderInline(stripMarker(line), `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }

        const heading = lines[0]!.match(/^(#{1,3})\s+(.*)$/);
        if (heading && lines.length === 1) {
          return (
            <p key={key} className="font-semibold text-[#4A443F]">
              {renderInline(heading[2]!, key)}
            </p>
          );
        }

        return (
          <p key={key} className="leading-relaxed">
            {lines.map((line, i) => (
              <React.Fragment key={`${key}-${i}`}>
                {i > 0 && <br />}
                {renderInline(line, `${key}-${i}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
