"use client";
import React, { useState, useCallback } from 'react';

// ============================================================
// Solidity 源码查看器 — 语法高亮、行号、一键复制、横向滚动
// ============================================================

interface SolidityViewerProps {
  code: string;
  filename?: string;
  showLineNumbers?: boolean;
  maxHeight?: string;
}

// ---- Tokenizer ----
function tokenizeSolidity(code: string): Array<{ text: string; type: string }> {
  const tokens: Array<{ text: string; type: string }> = [];

  // Solidity 关键字
  const KEYWORDS = new Set([
    'pragma', 'import', 'contract', 'library', 'interface', 'abstract',
    'function', 'modifier', 'event', 'error', 'struct', 'enum', 'mapping',
    'using', 'for', 'is', 'as', 'returns', 'return', 'require', 'revert',
    'assert', 'if', 'else', 'for', 'while', 'do', 'break', 'continue',
    'constructor', 'fallback', 'receive',
    'public', 'private', 'internal', 'external',
    'view', 'pure', 'payable', 'virtual', 'override',
    'constant', 'immutable', 'storage', 'memory', 'calldata',
    'delete', 'new', 'this', 'super', 'emit', 'assembly',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'bool', 'string', 'bytes', 'bytes1', 'bytes2', 'bytes4', 'bytes8',
    'bytes16', 'bytes32', 'address',
    'true', 'false', 'null',
    'type', 'var', 'let',
    'try', 'catch',
    'unchecked',
  ]);

  // 类型关键字（额外高亮分组）
  const TYPES = new Set([
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uint128', 'uint256',
    'int', 'int8', 'int16', 'int32', 'int64', 'int128', 'int256',
    'bool', 'string', 'bytes', 'bytes1', 'bytes2', 'bytes4', 'bytes8',
    'bytes16', 'bytes32', 'address', 'mapping',
  ]);

  // 正则组合：先匹配注释、字符串、数字、标识符，再 fallback 到单字符
  const pattern = [
    /(\/\/[^\n]*)/,                     // 单行注释
    /(\/\*[\s\S]*?\*\/)/,            // 多行注释
    /("(?:[^"\\]|\\.)*")/,             // 双引号字符串
    /('(?:[^'\\]|\\.)*')/,             // 单引号字符串
    /\b(\d+\.?\d*)\b/,               // 数字
    /(0x[0-9a-fA-F]+)/,                    // 十六进制
    /(@[\w.]+)/,                           // Solidity 特殊标识 @version 等
    /([\w$][\w$]*)/,                     // 普通标识符/关键字
    /([^\w\s])/,                         // 单个符号字符
  ];

  // 拼接正则（用 | 分隔每个捕获组）
  const combined = new RegExp(pattern.map(r => r.source).join('|'), 'g');

  let match;
  let lastIndex = 0;

  // 手动遍历 matches
  const execIterator = () => {
    const results: Array<{ text: string; index: number }> = [];
    let m;
    while ((m = combined.exec(code)) !== null) {
      const fullMatch = m[0];
      const idx = m.index;

      // 补上 match 之间的空白/分隔符
      if (idx > lastIndex) {
        const between = code.slice(lastIndex, idx);
        tokens.push({ text: between, type: 'plain' });
      }

      // 判断是哪一组捕获到了
      if (m[1] !== undefined) {
        tokens.push({ text: fullMatch, type: 'comment' });
      } else if (m[2] !== undefined) {
        tokens.push({ text: fullMatch, type: 'comment' });
      } else if (m[3] !== undefined) {
        tokens.push({ text: fullMatch, type: 'string' });
      } else if (m[4] !== undefined) {
        tokens.push({ text: fullMatch, type: 'string' });
      } else if (m[5] !== undefined) {
        tokens.push({ text: fullMatch, type: 'number' });
      } else if (m[6] !== undefined) {
        tokens.push({ text: fullMatch, type: 'number' });
      } else if (m[7] !== undefined) {
        tokens.push({ text: fullMatch, type: 'annotation' });
      } else if (m[8] !== undefined) {
        const word = fullMatch;
        if (KEYWORDS.has(word)) {
          if (TYPES.has(word)) {
            tokens.push({ text: word, type: 'type' });
          } else {
            tokens.push({ text: word, type: 'keyword' });
          }
        } else {
          tokens.push({ text: word, type: 'plain' });
        }
      } else if (m[9] !== undefined) {
        tokens.push({ text: fullMatch, type: 'symbol' });
      } else {
        tokens.push({ text: fullMatch, type: 'plain' });
      }

      lastIndex = m.index + fullMatch.length;

      // 防止死循环
      if (fullMatch.length === 0) break;
    }
  };

  execIterator();

  // 补上最后一段
  if (lastIndex < code.length) {
    tokens.push({ text: code.slice(lastIndex), type: 'plain' });
  }

  return tokens;
}

// ---- 颜色映射（Future Minimalism 调色板） ----
const tokenColors: Record<string, string> = {
  keyword: '#1D4ED8',     // 深蓝色 — 控制流、修饰符
  type: '#7C3AED',        // 紫色 — 类型名称
  comment: '#6B7280',     // 灰色 — 注释
  string: '#059669',      // 绿色 — 字符串
  number: '#D97706',      // 琥珀色 — 数字
  annotation: '#38bdf8',  // 天蓝 — 注解
  symbol: '#374151',      // 深灰 — 符号
  plain: '#111827',       // 近黑 — 普通文本
};

function CodeLine({ number, tokens, showNumber }: { number: number; tokens: Array<{ text: string; type: string }>; showNumber: boolean }) {
  return (
    <div style={{
      display: 'flex',
      minHeight: '22px',
      lineHeight: '22px',
      fontFamily: 'var(--font-mono)',
      fontSize: '13px',
      whiteSpace: 'pre' as const,
    }}>
      {showNumber && (
        <span style={{
          display: 'inline-block',
          width: '48px',
          minWidth: '48px',
          textAlign: 'right' as const,
          paddingRight: '16px',
          color: 'var(--text-quaternary)',
          userSelect: 'none' as const,
          fontSize: '12px',
          borderRight: '1px solid var(--border-subtle)',
          marginRight: '12px',
          flexShrink: 0,
        }}>
          {number}
        </span>
      )}
      <span style={{ whiteSpace: 'pre' as const }}>
        {tokens.map((t, i) => (
          <span key={i} style={{ color: tokenColors[t.type] || tokenColors.plain }}>
            {t.text}
          </span>
        ))}
      </span>
    </div>
  );
}

export default function SolidityViewer({
  code,
  filename,
  showLineNumbers: initialShowLineNumbers = true,
  maxHeight = '520px',
}: SolidityViewerProps) {
  const [showLineNumbers, setShowLineNumbers] = useState(initialShowLineNumbers);
  const [copied, setCopied] = useState(false);

  // 跨上下文复制工具（兼容 HTTP + HTTPS）
  const copyToClipboard = useCallback((text: string) => {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text);
    }
    return new Promise<void>((resolve, reject) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }, []);

  const handleCopy = useCallback(() => {
    copyToClipboard(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [code, copyToClipboard]);

  // 按行分割
  const lines = code.split('\n');
  const tokenizedLines = lines.map(line => tokenizeSolidity(line));

  // 计算数字宽度
  const lineNumWidth = Math.max(32, String(lines.length).length * 10 + 24);

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
      background: 'var(--bg-surface)',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-subtle)',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          {filename && (
            <span style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              📄 {filename}
            </span>
          )}
          <span style={{
            fontSize: '11px',
            color: 'var(--text-quaternary)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'nowrap',
          }}>
            .sol · {lines.length} 行
          </span>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            style={{
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: showLineNumbers ? 600 : 400,
              color: showLineNumbers ? 'var(--accent)' : 'var(--text-tertiary)',
              background: showLineNumbers ? 'var(--accent-subtle)' : 'transparent',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { if (!showLineNumbers) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={(e) => { if (!showLineNumbers) e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            # 行号
          </button>
          <button
            onClick={handleCopy}
            style={{
              padding: '3px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 500,
              color: copied ? 'var(--status-completed)' : 'var(--text-tertiary)',
              background: copied ? 'var(--status-completed-bg)' : 'transparent',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)'; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-tertiary)'; }}
          >
            {copied ? '✓ 已复制' : '📋 复制'}
          </button>
        </div>
      </div>

      {/* 代码区 — 横向滚动容器 */}
      <div style={{
        overflow: 'auto',
        maxHeight,
        padding: 'var(--space-3) 0',
      }}>
        {tokenizedLines.map((tokens, i) => (
          <CodeLine
            key={i}
            number={i + 1}
            tokens={tokens}
            showNumber={showLineNumbers}
          />
        ))}
      </div>
    </div>
  );
}
