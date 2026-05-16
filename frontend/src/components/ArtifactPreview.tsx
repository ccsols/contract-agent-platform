'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';

export type ArtifactAgent = 'doc' | 'tech' | 'dev' | 'ui';

function flattenText(children: React.ReactNode): string {
  if (children == null || children === false) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join('');
  if (React.isValidElement(children) && children.props && 'children' in children.props) {
    return flattenText((children.props as { children?: React.ReactNode }).children);
  }
  return '';
}

const highlighterBaseStyle: React.CSSProperties = {
  margin: 0,
  borderRadius: '8px',
  fontSize: '13px',
  lineHeight: 1.55,
  padding: '14px 16px',
};

const copyBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-standard)',
  background: 'rgba(255, 255, 255, 0.55)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

function normalizePrismLanguage(lang: string | undefined): string {
  const l = (lang || '').toLowerCase().trim();
  const map: Record<string, string> = {
    sh: 'bash',
    shell: 'bash',
    yml: 'yaml',
    sol: 'solidity',
  };
  return map[l] || l || 'typescript';
}

function CodeBlock({
  code,
  language,
  showCopy,
}: {
  code: string;
  language: string;
  showCopy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const lang = normalizePrismLanguage(language);

  const onCopy = useCallback(() => {
    void navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div style={{ margin: '14px 0' }}>
      {showCopy && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '6px' }}>
          <button type="button" onClick={onCopy} style={copyBtnStyle}>
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        PreTag="div"
        customStyle={{
          ...highlighterBaseStyle,
          maxHeight: 'min(55vh, 420px)',
          overflow: 'auto',
        }}
        codeTagProps={{
          style: {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            whiteSpace: 'pre',
            wordBreak: 'normal',
          },
        }}
        showLineNumbers
        wrapLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function buildMarkdownComponents(): Components {
  return {
    h1: ({ children }) => (
      <h1
        style={{
          fontSize: '1.35rem',
          fontWeight: 700,
          color: '#f8fafc',
          margin: '1.1em 0 0.5em',
          paddingBottom: '0.35em',
          borderBottom: '1px solid #334155',
        }}
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        style={{
          fontSize: '1.15rem',
          fontWeight: 600,
          color: '#e2e8f0',
          margin: '1em 0 0.45em',
        }}
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#cbd5e1', margin: '0.85em 0 0.35em' }}>
        {children}
      </h3>
    ),
    p: ({ children }) => (
      <p style={{ margin: '0.55em 0', color: '#e2e8f0', lineHeight: 1.65 }}>
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul style={{ margin: '0.45em 0', paddingLeft: '1.35em', color: '#e2e8f0', lineHeight: 1.65 }}>
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol style={{ margin: '0.45em 0', paddingLeft: '1.35em', color: '#e2e8f0', lineHeight: 1.65 }}>
        {children}
      </ol>
    ),
    li: ({ children }) => <li style={{ margin: '0.2em 0' }}>{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        style={{
          margin: '0.75em 0',
          padding: '0.5em 0 0.5em 1em',
          borderLeft: '3px solid #3b82f6',
          background: 'rgba(59, 130, 246, 0.08)',
          color: '#cbd5e1',
        }}
      >
        {children}
      </blockquote>
    ),
    a: ({ children, href }) => (
      <a href={href} style={{ color: '#60a5fa', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    hr: () => <hr style={{ border: 'none', borderTop: '1px solid #334155', margin: '1.25em 0' }} />,
    table: ({ children }) => (
      <div style={{ overflowX: 'auto', margin: '0.85em 0' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '13px' }}>{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th
        style={{
          border: '1px solid #334155',
          padding: '8px 10px',
          textAlign: 'left',
          background: '#1e293b',
          color: '#f1f5f9',
        }}
      >
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td style={{ border: '1px solid #334155', padding: '8px 10px', color: '#e2e8f0' }}>{children}</td>
    ),
    strong: ({ children }) => <strong style={{ color: '#f8fafc', fontWeight: 600 }}>{children}</strong>,
    code: (props) => {
      const { children, className } = props;
      const inline = !className;
      const codeString = flattenText(children).replace(/\n$/, '');
      if (inline) {
        return (
          <code
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.9em',
              background: 'rgba(51, 65, 85, 0.6)',
              padding: '2px 6px',
              borderRadius: '4px',
              color: '#fbbf24',
            }}
          >
            {children}
          </code>
        );
      }
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : 'typescript';
      return <CodeBlock code={codeString} language={lang} />;
    },
    pre: ({ children }) => <>{children}</>,
  };
}

function PlainFallback({ content }: { content: string }) {
  return (
    <pre
      style={{
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.6,
        color: '#cbd5e1',
        fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {content}
    </pre>
  );
}

export function ArtifactPreview({ agent, content }: { agent: ArtifactAgent; content: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const markdownComponents = useMemo(() => buildMarkdownComponents(), []);

  if (!mounted) {
    return <PlainFallback content={content} />;
  }

  if (agent === 'dev') {
    return <CodeBlock code={content} language="solidity" showCopy />;
  }

  if (agent === 'ui') {
    return <CodeBlock code={content} language="tsx" showCopy />;
  }

  if (agent === 'doc' || agent === 'tech') {
    return (
      <div
        style={{
          fontSize: '14px',
          lineHeight: 1.65,
          color: '#e2e8f0',
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  return <PlainFallback content={content} />;
}
