"use client";
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

// ============================================================
// 轻量级 Markdown 渲染组件 — 语义化渲染 + 源码/预览模式切换
// ============================================================

interface MarkdownViewProps {
  content: string;
  minHeight?: string;
  maxHeight?: string;
  className?: string;
}

const mdStyles = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  } as React.CSSProperties,
  toolbar: {
    display: 'flex',
    gap: '4px',
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-panel)',
  } as React.CSSProperties,
  modeBtn: (active: boolean) => ({
    padding: '4px 12px',
    borderRadius: 'var(--radius-sm)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent)' : 'var(--text-tertiary)',
    background: active ? 'var(--accent-subtle)' : 'transparent',
    transition: 'all 0.15s',
  } as React.CSSProperties),
  content: (maxHeight?: string) => ({
    flex: 1,
    overflow: 'auto',
    padding: 'var(--space-4) var(--space-5)',
    maxHeight: maxHeight || '520px',
    lineHeight: 1.7,
    fontSize: '14px',
    color: 'var(--text-secondary)',
  } as React.CSSProperties),
  sourcePre: {
    margin: 0,
    fontSize: 'var(--fs-sm)',
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
};

// 自定义 Markdown 渲染组件（与 Future Minimalism 风格协调）
const MarkdownComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 style={{
      fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)',
      letterSpacing: '-0.4px', margin: '0 0 12px 0', paddingBottom: '8px',
      borderBottom: '1px solid var(--border-subtle)',
    }} {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 style={{
      fontSize: '17px', fontWeight: 600, color: 'var(--text-primary)',
      letterSpacing: '-0.3px', margin: '20px 0 10px 0',
    }} {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 style={{
      fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)',
      margin: '16px 0 8px 0',
    }} {...props}>{children}</h3>
  ),
  p: ({ children, ...props }) => (
    <p style={{
      margin: '0 0 10px 0', lineHeight: 1.7, color: 'var(--text-secondary)',
    }} {...props}>{children}</p>
  ),
  ul: ({ children, ...props }) => (
    <ul style={{
      margin: '0 0 12px 0', paddingLeft: '20px',
      listStyleType: 'disc',
    }} {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }) => (
    <ol style={{
      margin: '0 0 12px 0', paddingLeft: '20px',
    }} {...props}>{children}</ol>
  ),
  li: ({ children, ...props }) => (
    <li style={{
      marginBottom: '4px', lineHeight: 1.6, color: 'var(--text-secondary)',
    }} {...props}>{children}</li>
  ),
  strong: ({ children, ...props }) => (
    <strong style={{ fontWeight: 600, color: 'var(--text-primary)' }} {...props}>{children}</strong>
  ),
  em: ({ children, ...props }) => (
    <em style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }} {...props}>{children}</em>
  ),
  code: ({ className, children, ...props }) => {
    // Inline code (no language class)
    const isInline = !className;
    if (isInline) {
      return (
        <code style={{
          fontFamily: 'var(--font-mono)', fontSize: '13px',
          background: 'var(--bg-subtle)', padding: '2px 6px',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--accent)', wordBreak: 'break-word',
        }} {...props}>{children}</code>
      );
    }
    // Block code already handled by pre wrapper
    return <code className={className} style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }} {...props}>{children}</code>;
  },
  pre: ({ children, ...props }) => (
    <pre style={{
      fontFamily: 'var(--font-mono)', fontSize: '13px',
      lineHeight: 1.6, overflow: 'auto',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      margin: '0 0 14px 0',
    }} {...props}>{children}</pre>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote style={{
      margin: '0 0 14px 0', padding: '8px 16px',
      borderLeft: '3px solid var(--accent)',
      background: 'var(--accent-subtle)',
      borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
      color: 'var(--text-tertiary)',
      fontStyle: 'italic',
    }} {...props}>{children}</blockquote>
  ),
  hr: () => (
    <hr style={{
      margin: '16px 0', border: 'none',
      borderTop: '1px solid var(--border-standard)',
    }} />
  ),
  a: ({ children, href, ...props }) => (
    <a href={href}
      style={{
        color: 'var(--accent)',
        textDecoration: 'none',
        fontWeight: 500,
        borderBottom: '1px solid transparent',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'var(--accent)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
      target="_blank" rel="noopener noreferrer"
      {...props}>{children}</a>
  ),
  table: ({ children, ...props }) => (
    <div style={{ overflowX: 'auto', margin: '0 0 14px 0' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        fontSize: '13px', lineHeight: 1.6,
      }} {...props}>{children}</table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th style={{
      padding: '8px 12px', borderBottom: '2px solid var(--border-standard)',
      fontWeight: 600, textAlign: 'left', color: 'var(--text-primary)',
      background: 'var(--bg-panel)',
    }} {...props}>{children}</th>
  ),
  td: ({ children, ...props }) => (
    <td style={{
      padding: '6px 12px', borderBottom: '1px solid var(--border-subtle)',
      color: 'var(--text-secondary)',
    }} {...props}>{children}</td>
  ),
};

export default function MarkdownView({ content, minHeight, maxHeight, className }: MarkdownViewProps) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');

  return (
    <div style={mdStyles.wrapper} className={className}>
      <div style={mdStyles.toolbar}>
        <button
          onClick={() => setMode('preview')}
          style={mdStyles.modeBtn(mode === 'preview')}
          onMouseEnter={(e) => { if (mode !== 'preview') e.currentTarget.style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { if (mode !== 'preview') e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          预览
        </button>
        <button
          onClick={() => setMode('source')}
          style={mdStyles.modeBtn(mode === 'source')}
          onMouseEnter={(e) => { if (mode !== 'source') e.currentTarget.style.color = 'var(--text-secondary)'; }}
          onMouseLeave={(e) => { if (mode !== 'source') e.currentTarget.style.color = 'var(--text-tertiary)'; }}
        >
          源码
        </button>
      </div>
      <div style={{ ...mdStyles.content(maxHeight), minHeight: minHeight }}>
        {mode === 'source' ? (
          <pre style={mdStyles.sourcePre}>{content}</pre>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={MarkdownComponents}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
