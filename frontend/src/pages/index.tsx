"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore, Template, AgentStatus, EventLog } from '@/store';
import MarkdownView from '@/components/MarkdownView';
import SolidityViewer from '@/components/SolidityViewer';

// ============================================================
// 模板配置
// ============================================================
const TEMPLATES: Template[] = [
  { id: 'housing_lease', name: '住房租赁合同', description: '房东与租客之间的住房租赁协议', icon: '⌂' },
  { id: 'employment', name: '雇佣合同', description: '雇主与员工之间的雇佣协议', icon: '⚡' },
  { id: 'goods_trade', name: '商品交易合同', description: '买卖双方之间的商品交易协议', icon: '⇄' },
  { id: 'custom', name: '自定义合同', description: '上传合同文本或直接描述需求', icon: '✦' },
];

const BACKEND_URL = 'http://122.51.247.121:5000';

const AGENT_CONFIG = [
  { key: 'doc',  label: '文档 Agent',  color: 'var(--agent-doc)' },
  { key: 'tech', label: '技术 Agent',  color: 'var(--agent-tech)' },
  { key: 'dev',  label: '开发 Agent',  color: 'var(--agent-dev)' },
  { key: 'ui',   label: 'UI Agent',   color: 'var(--agent-ui)' },
];

// ============================================================
// 样式 (Future Minimalism)
// ============================================================
const s = {
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-standard)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-6)',
    boxShadow: 'var(--shadow-md)',
    transition: 'box-shadow 0.2s',
  } as React.CSSProperties,
  panel: {
    background: 'var(--bg-panel)',
    border: '1px solid var(--border-standard)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
  } as React.CSSProperties,
  btnPrimary: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
    padding: '10px 24px',
    background: 'var(--gradient-main)',
    backgroundSize: '200% auto',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-base)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.2s, box-shadow 0.2s',
    lineHeight: 1.4,
  } as React.CSSProperties,
  btnGhost: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    padding: '10px 20px',
    background: 'var(--bg-surface)',
    color: 'var(--text-secondary)',
    border: '1px solid var(--border-standard)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-base)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'border-color 0.15s, box-shadow 0.15s, background 0.15s',
    lineHeight: 1.4,
  } as React.CSSProperties,
  btnSmall: {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '6px 14px',
    background: 'var(--bg-panel)',
    color: 'var(--text-tertiary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-pill)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  } as React.CSSProperties,
  input: {
    width: '100%', padding: '11px 14px',
    background: 'var(--bg-canvas)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-standard)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-base)',
    fontFamily: 'var(--font-sans)',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    lineHeight: 1.5,
  } as React.CSSProperties,
  label: {
    display: 'block',
    color: 'var(--text-secondary)',
    fontSize: 'var(--fs-base)',
    fontWeight: 500,
    marginBottom: '6px',
  } as React.CSSProperties,
  agentPill: (isActive: boolean, color: string, status: string) => ({
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    padding: '8px 18px',
    background: isActive ? `var(--gradient-main)` : 'var(--bg-panel)',
    backgroundSize: '200% auto' as any,
    border: `1px solid ${isActive ? 'transparent' : 'var(--border-standard)'}`,
    borderRadius: 'var(--radius-pill)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: 'var(--fs-base)',
    fontWeight: 500,
    color: isActive ? '#fff' :
           status === 'completed' ? 'var(--status-completed)' :
           status === 'running' ? 'var(--text-primary)' :
           status === 'failed' ? 'var(--status-failed)' :
           'var(--text-tertiary)',
    opacity: status === 'idle' && !isActive ? 0.5 : 1,
    boxShadow: isActive ? '0 2px 12px rgba(37, 99, 235, 0.25)' : 'none',
  } as React.CSSProperties),
  statusDot: (status: string) => ({
    width: '8px', height: '8px', borderRadius: '50%',
    background: status === 'completed' ? 'var(--status-completed)' :
                status === 'running' ? '#fff' :
                status === 'failed' ? 'var(--status-failed)' :
                'var(--status-idle)',
    transition: 'all 0.3s',
  } as React.CSSProperties),
};

// ============================================================
// 工具函数
// ============================================================
function getEventIcon(type: string): string {
  const icons: Record<string, string> = {
    pipeline_started: '▶', phase_started: '◇', agent_started: '○',
    agent_thinking: '…', agent_completed: '✓', artifact_ready: '◆',
    confirmations_required: '△', pipeline_continued: '▷',
    pipeline_completed: '●', pipeline_error: '✕',
  };
  return icons[type] || '·';
}
function formatTime(ts: number | string): string {
  if (!ts && ts !== 0) return '';
  let date: Date;
  if (typeof ts === 'string') {
    date = new Date(ts);
  } else if (ts > 1e12) {
    date = new Date(ts);
  } else {
    date = new Date(ts * 1000);
  }
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

// ============================================================
// SSE Hook
// ============================================================
function useSSE(projectId: string | null, enabled: boolean) {
  const { updateAgentStatus, setConfirmations, setCurrentStep, setDemoUrl, setIsLoading, addMessage,
    addEventLog, addAgentThought, clearEventLogs, clearAgentThoughts, setAgentArtifact, setRequirementDoc, setTechDesign, setAllArtifacts } = useStore();
  const esRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<number>(0);

  const fetchAllArtifacts = useCallback(async (pid: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/project/${pid}/artifacts`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.artifacts) setAllArtifacts(d.artifacts);
    } catch (e) {}
  }, [setAllArtifacts]);

  const connect = useCallback((pid: string) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    clearEventLogs(); clearAgentThoughts();
    lastEventIdRef.current = 0;
    const es = new EventSource(`${BACKEND_URL}/api/project/${pid}/events`);
    esRef.current = es;
    const h = (et: string) => (ev: MessageEvent) => {
      try { const d = JSON.parse(ev.data); addEventLog({ id: `${et}-${++lastEventIdRef.current}`, type: et, phase: d.phase, content: d.content || d.message, timestamp: d.timestamp || Date.now(), data: d }); } catch (e) {}
    };
    es.addEventListener('pipeline_started', (ev) => { h('pipeline_started')(ev); setIsLoading(true); });
    es.addEventListener('phase_started', (ev) => { h('phase_started')(ev); try { const d = JSON.parse(ev.data); updateAgentStatus(d.phase, { status: 'running', message: d.message || '执行中...', progress: 50 }); } catch (e) {} });
    es.addEventListener('agent_started', (ev) => { h('agent_started')(ev); try { const d = JSON.parse(ev.data); updateAgentStatus(d.phase, { status: 'running', message: d.message || '启动中...', progress: 30 }); } catch (e) {} });
    es.addEventListener('agent_thinking', (ev) => { h('agent_thinking')(ev); try { const d = JSON.parse(ev.data); if (d.phase && d.content) addAgentThought(d.phase, d.content); } catch (e) {} });
    es.addEventListener('agent_completed', (ev) => { h('agent_completed')(ev); try { const d = JSON.parse(ev.data); updateAgentStatus(d.phase, { status: 'completed', message: d.duration ? `完成 (${d.duration})` : '完成', progress: 100 }); } catch (e) {} });
    es.addEventListener('artifact_ready', (ev) => {
      h('artifact_ready')(ev);
      try { const d = JSON.parse(ev.data); if (d.artifact_type === 'requirement') fetchArtifact(pid, 'requirement'); else if (d.artifact_type === 'tech_design') fetchArtifact(pid, 'tech_design'); } catch (e) {}
    });
    es.addEventListener('confirmations_required', (ev) => { h('confirmations_required')(ev); try { const d = JSON.parse(ev.data); if (d.confirmations?.length) { setConfirmations(d.confirmations); setCurrentStep(2); setIsLoading(false); } } catch (e) {} });
    es.addEventListener('pipeline_continued', (ev) => h('pipeline_continued')(ev));
    es.addEventListener('pipeline_completed', (ev) => {
      h('pipeline_completed')(ev);
      try { const d = JSON.parse(ev.data); setDemoUrl(d.demo_url || `/demo/${pid}`); setCurrentStep(4); setIsLoading(false); ['doc','tech','dev','ui'].forEach(a => updateAgentStatus(a, { status: 'completed', message: '完成', progress: 100 })); es.close(); esRef.current = null; fetchAllArtifacts(pid); } catch (e) {}
    });
    es.addEventListener('pipeline_error', (ev) => { h('pipeline_error')(ev); try { const d = JSON.parse(ev.data); addMessage?.('error', `[错误] ${d.error || '生成失败'}`); setIsLoading(false); es.close(); esRef.current = null; } catch (e) {} });
    es.addEventListener('__done__', () => { es.close(); esRef.current = null; });
    es.onerror = () => {};
  }, [updateAgentStatus, setConfirmations, setCurrentStep, setDemoUrl, setIsLoading, addMessage, addEventLog, addAgentThought, clearEventLogs, clearAgentThoughts, fetchAllArtifacts]);

  const fetchArtifact = async (pid: string, t: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/project/${pid}/artifact/${t}`);
      if (!res.ok) return;
      const d = await res.json();
      if (t === 'requirement') { setRequirementDoc(d.data); setAgentArtifact('doc', fmtReq(d.data)); }
      else if (t === 'tech_design') { setTechDesign(d.data); setAgentArtifact('tech', fmtTech(d.data)); }
    } catch (e) {}
  };
  return { connect, disconnect: () => { esRef.current?.close(); esRef.current = null; }, fetchAllArtifacts };
}

function fmtReq(data: any): string {
  if (!data) return '暂无数据';
  const terms = data.terms || [];
  return [`# ${data.project_name || '未命名项目'}`, `**, 模板**: ${data.template}  **摘要**: ${data.summary || '无'}`,
    '', `## 参与方`, data.parties ? Object.entries(data.parties).map(([k, v]) => `  - ${k}: ${v}`).join('\n') : '  无',
    '', `## 条款`, terms.map((t: any) => `  - ${t.id} [${t.type}] ${t.description} (${t.eligible})`).join('\n') || '  无',
    '', `## 可合约化条款`, (data.contractable_terms || []).join(', ') || '无',
    '', `## 待确认条款`, (data.pending_terms || []).join(', ') || '无', ].join('\n');
}
function fmtTech(data: any): string {
  if (!data) return '暂无数据';
  const c = data.contracts || [], r = data.risks || [];
  return [`# 技术设计方案`, '', `## 合约架构`, c.map((x: any) => `  - **${x.name}** (${x.type}): ${x.description}\n    方法: ${(x.functions || []).join(', ')}`).join('\n') || '  无',
    '', `## 设计模式`, (data.patterns || []).join(', ') || '无', '', `## 依赖`, (data.dependencies || []).join(', ') || '无',
    '', `## 风险评估`, r.map((x: any) => `  - ${x.type}: ${x.level} - ${x.mitigation || '无'}`).join('\n') || '  无', ].join('\n');
}

// ============================================================
// 主页面
// ============================================================
export default function HomePage() {
  const { currentStep, setCurrentStep, selectedTemplate, setSelectedTemplate, requirementForm, updateRequirementForm,
    agentStatuses, updateAgentStatus, confirmations, updateConfirmation, demoUrl, setDemoUrl, isLoading, setIsLoading,
    addMessage, reset, eventLogs, agentThoughts, agentArtifacts, allArtifacts, projects, setProjects, setAllArtifacts } = useStore();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sse = useSSE(projectId, sseConnected);

  const startGeneration = useCallback(async () => {
    setIsLoading(true); setCurrentStep(3);
    useStore.getState().clearEventLogs(); useStore.getState().clearAgentThoughts(); useStore.getState().setAllArtifacts({});
    ['doc','tech','dev','ui'].forEach(a => updateAgentStatus(a, { status: 'idle', message: '等待中...', progress: 0 }));
    updateAgentStatus('orchestrator', { status: 'idle', message: '等待中...', progress: 0 });
    try {
      const res = await fetch(`${BACKEND_URL}/api/generate/nested`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template: selectedTemplate?.id, ...requirementForm }),
      });
      if (!res.ok) throw new Error('生成失败');
      const d = await res.json();
      const pid = d.project_id; setProjectId(pid);
      if (pid) { sse.connect(pid); setSseConnected(true); }
    } catch (error) { addMessage?.('error', '[错误] 后端服务不可用'); setIsLoading(false); }
  }, [selectedTemplate, requirementForm, updateAgentStatus, setCurrentStep, setIsLoading, addMessage, sse]);

  const handleConfirmation = useCallback(async (id: string, sel: string) => {
    updateConfirmation(id, sel);
    if (projectId) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/project/${projectId}/confirm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation_id: id, selected: sel }),
        });
        if (!res.ok) throw new Error('确认失败');
        const d = await res.json();
        if (d.status === 'continuing') { setCurrentStep(3); ['dev','ui'].forEach(a => updateAgentStatus(a, { status: 'idle', message: '等待中...', progress: 0 })); setIsLoading(true); }
      } catch (e) {}
    }
  }, [projectId, updateConfirmation, setIsLoading, sse]);

  const handleReset = useCallback(() => { sse.disconnect(); setSseConnected(false); reset(); setProjectId(null); }, [sse, reset]);

  const openHistory = useCallback(async () => {
    setLoadingHistory(true); setHistoryOpen(true);
    try { const res = await fetch(`${BACKEND_URL}/api/projects`); if (res.ok) { const d = await res.json(); setProjects(d.projects || []); } } catch (e) {}
    setLoadingHistory(false);
  }, [setProjects]);

  const closeHistory = useCallback(() => { setHistoryOpen(false); }, []);

  const viewHistoryProject = useCallback(async (pid: string) => {
    setLoadingHistory(true);
    try {
      const [mr, ar] = await Promise.all([
        fetch(`${BACKEND_URL}/api/project/${pid}/metadata`),
        fetch(`${BACKEND_URL}/api/project/${pid}/artifacts`),
      ]);
      if (mr.ok && ar.ok) { setAllArtifacts((await ar.json()).artifacts || {}); setDemoUrl(`/demo/${pid}`); setProjectId(pid); setHistoryOpen(false); setCurrentStep(4); }
    } catch (e) {}
    setLoadingHistory(false);
  }, [setAllArtifacts, setDemoUrl, setCurrentStep]);

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header — floating, minimal */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(250,250,250,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: 'var(--space-4) var(--space-6)',
      }}>
        <div style={{ maxWidth: '1024px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: 'var(--radius-sm)',
              background: 'var(--gradient-main)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '16px', color: '#fff', fontWeight: 600,
            }}>⧩</div>
            <div>
              <h1 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
                AI 合约智能体
              </h1>
              <p style={{ fontSize: '12px', color: 'var(--text-quaternary)', fontWeight: 400, letterSpacing: '0.2px' }}>
                全链路自动化智能合约生成
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {sseConnected && projectId && (
              <span style={{ fontSize: '11px', color: 'var(--status-completed)', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', background: 'var(--status-completed-bg)', borderRadius: 'var(--radius-pill)' }}>
                <span className="animate-pulse" style={{ fontSize: '8px' }}>●</span> Live
              </span>
            )}
            <button onClick={openHistory} style={s.btnSmall}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
              ≡ 历史
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1024px', margin: '0 auto', padding: 'var(--space-10) var(--space-6)' }}>
        {/* 非历史模式 */}
        {!historyOpen && currentStep === 0 && <TemplateSelector templates={TEMPLATES} onSelect={(t) => { setSelectedTemplate(t); setCurrentStep(1); }} />}
        {!historyOpen && currentStep === 1 && selectedTemplate && <RequirementForm template={selectedTemplate} formData={requirementForm} onUpdate={updateRequirementForm} onBack={() => setCurrentStep(0)} onSubmit={startGeneration} />}
        {!historyOpen && currentStep === 2 && <ConfirmationView confirmations={confirmations} onConfirm={handleConfirmation} onBack={() => setCurrentStep(1)} />}
        {!historyOpen && currentStep === 3 && <GenerationView agentStatuses={agentStatuses} eventLogs={eventLogs} agentThoughts={agentThoughts} agentArtifacts={agentArtifacts} isLoading={isLoading} projectId={projectId} />}
        {!historyOpen && currentStep === 4 && demoUrl && <DemoView projectId={projectId} demoUrl={demoUrl} onReset={handleReset} allArtifacts={allArtifacts} />}

        {/* 历史模式 */}
        {historyOpen && <HistoryView projects={projects} loading={loadingHistory} onSelect={viewHistoryProject} onBack={closeHistory} />}
      </main>
    </div>
  );
}

// ============================================================
// 模板选择 — 精密卡片网格
// ============================================================
function TemplateSelector({ templates, onSelect }: { templates: Template[]; onSelect: (t: Template) => void }) {
  return (
    <div className="animate-slideUp">
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-10)' }}>
        <h2 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.6px', marginBottom: '8px' }}>
          选择合同模板
        </h2>
        <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-tertiary)' }}>选择一个模板开始生成智能合约</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
        {templates.map((t, i) => (
          <button key={t.id} onClick={() => onSelect(t)}
            style={{
              ...s.btnGhost, flexDirection: 'column', alignItems: 'flex-start',
              padding: 'var(--space-6) var(--space-5)', textAlign: 'left',
              borderRadius: 'var(--radius-lg)', gap: 'var(--space-3)', height: 'auto',
              border: '1px solid var(--border-standard)', background: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-sm)',
              animation: `slideUp 0.35s cubic-bezier(0.16,1,0.3,1) ${i * 0.06}s both`,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-standard)'; e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; }}>
            <span style={{
              width: '40px', height: '40px', borderRadius: 'var(--radius-sm)',
              background: 'var(--gradient-main)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '18px', fontWeight: 600,
            }}>{t.icon}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 'var(--fs-md)' }}>{t.name}</span>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>{t.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 需求表单 — 精密输入
// ============================================================
function RequirementForm({ template, formData, onUpdate, onBack, onSubmit }: {
  template: Template; formData: Record<string, any>; onUpdate: (k: string, v: any) => void; onBack: () => void; onSubmit: () => void;
}) {
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleOcrUpload = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setOcrLoading(true);
    setOcrError('');
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('template', template.id);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ocr/parse`, {
        method: 'POST', body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'OCR 识别失败');
      }
      const data = await res.json();
      if (data.fields) {
        // 逐个填充表单字段
        Object.entries(data.fields).forEach(([key, value]) => {
          if (value) onUpdate(key, value);
        });
      }
      if (data.pages_processed > 1) {
        // 提示用户已处理多页
        console.log(`✅ OCR 处理了 ${data.pages_processed} 页`);
      }
    } catch (e: any) {
      setOcrError(e.message || 'OCR 处理出错');
    }
    setOcrLoading(false);
  }, [template.id, onUpdate]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleOcrUpload(Array.from(files));
    }
    // 重置 input 以允许重复上传
    e.target.value = '';
  }, [handleOcrUpload]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleOcrUpload(Array.from(files));
    }
  }, [handleOcrUpload]);

  const renderField = (field: any) => {
    const v = formData[field.id] || '';
    const fOn = (e: any) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = 'var(--shadow-focus)'; };
    const fOff = (e: any) => { e.target.style.borderColor = 'var(--border-standard)'; e.target.style.boxShadow = 'none'; };
    if (field.type === 'text') return <input type="text" value={v} onChange={(e) => onUpdate(field.id, e.target.value)} placeholder={`请输入${field.label}`} style={s.input} onFocus={fOn} onBlur={fOff} />;
    if (field.type === 'number') return <input type="number" value={v} onChange={(e) => onUpdate(field.id, parseInt(e.target.value) || 0)} placeholder={`请输入${field.label}`} style={s.input} onFocus={fOn} onBlur={fOff} />;
    if (field.type === 'date') return <input type="date" value={v} onChange={(e) => onUpdate(field.id, e.target.value)} style={s.input} onFocus={fOn} onBlur={fOff} />;
    if (field.type === 'textarea') return <textarea value={v} onChange={(e) => onUpdate(field.id, e.target.value)} placeholder={`请输入${field.label}`} rows={3} style={{ ...s.input, resize: 'vertical', minHeight: '90px' }} onFocus={fOn} onBlur={fOff} />;
    return null;
  };
  const getFields = () => {
    if (template.id === 'housing_lease') return [
      { id: 'name', label: '项目名称', type: 'text' }, { id: 'landlord', label: '房东姓名', type: 'text' },
      { id: 'tenant', label: '租客姓名', type: 'text' }, { id: 'property', label: '房屋地址', type: 'text' },
      { id: 'monthly_rent', label: '月租金(元)', type: 'number' }, { id: 'deposit', label: '押金(月)', type: 'number' },
      { id: 'start_date', label: '租期开始', type: 'date' }, { id: 'end_date', label: '租期结束', type: 'date' },
      { id: 'payment_day', label: '每月租金支付日', type: 'number' },
    ];
    if (template.id === 'employment') return [
      { id: 'name', label: '项目名称', type: 'text' }, { id: 'employer', label: '雇主名称', type: 'text' },
      { id: 'employee', label: '员工姓名', type: 'text' }, { id: 'position', label: '职位', type: 'text' },
      { id: 'salary', label: '月薪(元)', type: 'number' }, { id: 'start_date', label: '合同开始', type: 'date' },
      { id: 'end_date', label: '合同结束', type: 'date' },
    ];
    if (template.id === 'goods_trade') return [
      { id: 'name', label: '项目名称', type: 'text' }, { id: 'seller', label: '卖方', type: 'text' },
      { id: 'buyer', label: '买方', type: 'text' }, { id: 'goods', label: '商品名称', type: 'text' },
      { id: 'price', label: '总价(元)', type: 'number' }, { id: 'delivery_date', label: '交付日期', type: 'date' },
    ];
    return [{ id: 'name', label: '项目名称', type: 'text' }, { id: 'description', label: '需求描述', type: 'textarea' }];
  };
  const fields = getFields();
  return (
    <div className="animate-slideUp">
      <button onClick={onBack} style={{ ...s.btnSmall, marginBottom: 'var(--space-4)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
        ← 返回
      </button>
      <div style={s.card}>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', background: 'var(--gradient-main)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>{template.icon}</div>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>{template.name}</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-base)', marginTop: '4px' }}>{template.description}</p>
        </div>

        {/* OCR 上传区 */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${ocrLoading ? 'var(--accent)' : ocrError ? 'var(--status-failed)' : 'var(--border-medium)'}`,
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--space-5)',
            textAlign: 'center',
            cursor: 'pointer',
            marginBottom: 'var(--space-6)',
            transition: 'all 0.2s',
            background: ocrLoading ? 'var(--gradient-subtle)' : 'var(--bg-panel)',
          }}
          onMouseEnter={(e) => { if (!ocrLoading) e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { if (!ocrLoading) e.currentTarget.style.borderColor = 'var(--border-medium)'; }}
        >
          <input ref={fileInputRef} type="file" accept="image/*,.pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
          {ocrLoading ? (
            <div>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid var(--border-subtle)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', margin: '0 auto var(--space-3)' }} />
              <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-sm)' }}>正在识别合同内容...</p>
            </div>
          ) : ocrError ? (
            <div>
              <p style={{ color: 'var(--status-failed)', fontSize: 'var(--fs-sm)', marginBottom: '4px' }}>⚠ {ocrError}</p>
              <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-xs)' }}>点击重新上传或手动填写下方表单</p>
            </div>
          ) : (
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-base)', marginBottom: '4px' }}>📄 上传合同扫描件（支持多页）</p>
              <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-xs)' }}>可同时选择多张图片 / PDF，自动识别并合并所有页面的关键信息</p>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-5)' }}>
          {fields.map((f) => <div key={f.id} style={{ gridColumn: f.type === 'textarea' ? '1 / -1' : undefined }}><label style={s.label}>{f.label}</label>{renderField(f)}</div>)}
        </div>
        <div style={{ marginTop: 'var(--space-6)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onSubmit} style={s.btnPrimary}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.30)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.boxShadow = 'none'; }}>
            开始生成 →
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 确认视图 — 药丸选项
// ============================================================
function ConfirmationView({ confirmations, onConfirm, onBack }: { confirmations: any[]; onConfirm: (id: string, s: string) => void; onBack: () => void; }) {
  return (
    <div className="animate-slideUp">
      <button onClick={onBack} style={{ ...s.btnSmall, marginBottom: 'var(--space-4)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
        ← 返回修改
      </button>
      <div style={s.card}>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-6)', letterSpacing: '-0.4px' }}>需要您确认以下事项</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {confirmations.map((conf) => (
            <div key={conf.id} style={{ ...s.panel, padding: 'var(--space-5)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>{conf.title}</h3>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-base)', marginBottom: 'var(--space-4)' }}>{conf.description}</p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {conf.options.map((opt: string) => {
                  const sel = conf.selected === opt;
                  return <button key={opt} onClick={() => onConfirm(conf.id, opt)}
                    style={{ padding: '8px 20px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontSize: 'var(--fs-base)', fontWeight: 500, transition: 'all 0.15s',
                      background: sel ? 'var(--gradient-main)' : 'var(--bg-panel)',
                      color: sel ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                      boxShadow: sel ? '0 2px 8px rgba(37, 99, 235, 0.20)' : 'none',
                    }}
                    onMouseEnter={(e) => { if (!sel) { e.currentTarget.style.background = 'var(--bg-subtle)'; }}}
                    onMouseLeave={(e) => { if (!sel) { e.currentTarget.style.background = 'var(--bg-panel)'; }}}>{opt}</button>;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 生成中视图 — 光泽感实时日志
// ============================================================
function GenerationView({ agentStatuses, eventLogs, agentThoughts, agentArtifacts, isLoading, projectId }: {
  agentStatuses: AgentStatus[]; eventLogs: EventLog[]; agentThoughts: Record<string, string[]>; agentArtifacts: Record<string, any>; isLoading: boolean; projectId: string | null;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [activeAgent, setActiveAgent] = useState<string>('doc');
  const [showArtifact, setShowArtifact] = useState<string | null>(null);
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [eventLogs, agentThoughts]);
  useEffect(() => { const r = agentStatuses.find(a => a.agent !== 'orchestrator' && a.status === 'running'); if (r) setActiveAgent(r.agent); }, [agentStatuses]);
  const getColor = (k: string) => AGENT_CONFIG.find(a => a.key === k)?.color || 'var(--text-tertiary)';
  const getLabel = (k: string) => AGENT_CONFIG.find(a => a.key === k)?.label || k;
  return (
    <div className="animate-slideUp">
      <div style={s.card}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--gradient-main)', animation: 'glowPulse 2s ease-in-out infinite' }} />
            <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>AI 正在生成中</h2>
          </div>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-base)' }}>{isLoading ? 'Agent 正在实时协作生成您的合约' : '等待开始...'}</p>
        </div>

        {/* Agent 状态 — 渐变药丸 */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: 'var(--space-6)', justifyContent: 'center', flexWrap: 'wrap' }}>
          {agentStatuses.filter(a => a.agent !== 'orchestrator').map((st) => (
            <button key={st.agent} onClick={() => setActiveAgent(st.agent)}
              style={s.agentPill(activeAgent === st.agent, getColor(st.agent), st.status)}>
              <span style={s.statusDot(st.status)} /><span>{getLabel(st.agent)}</span>
              {st.status === 'completed' && <span style={{ fontSize: '12px', opacity: 0.7 }}>✓</span>}
              {st.status === 'failed' && <span style={{ fontSize: '12px' }}>✕</span>}
            </button>
          ))}
        </div>

        {/* 主内容 */}
        <div style={{ display: 'grid', gridTemplateColumns: showArtifact ? '1.2fr 0.8fr' : '1fr', gap: 'var(--space-4)', minHeight: '350px' }}>
          {/* 思考日志 */}
          <div style={{ ...s.panel, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
            <div style={{ padding: '12px var(--space-4)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{getLabel(activeAgent)} 思考</span>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-quaternary)', fontFamily: 'var(--font-mono)' }}>{(agentThoughts[activeAgent] || []).length} logs</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3)', maxHeight: '420px' }}>
              {(agentThoughts[activeAgent] || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px var(--space-4)', color: 'var(--text-quaternary)' }}><p style={{ fontSize: 'var(--fs-base)' }}>等待 {getLabel(activeAgent)} 执行...</p></div>
              ) : (
                (agentThoughts[activeAgent] || []).map((thought, i) => {
                  const isLatest = i === (agentThoughts[activeAgent] || []).length - 1;
                  const isAction = thought.startsWith('正在') || thought.startsWith('✅') || thought.startsWith('📄') || thought.startsWith('⚙️');
                  return <div key={i} style={{ padding: '6px 10px', marginBottom: '3px', borderRadius: 'var(--radius-sm)',
                    background: isLatest ? 'var(--gradient-subtle)' : 'transparent',
                    fontSize: isAction ? 'var(--fs-base)' : 'var(--fs-sm)', lineHeight: '1.6',
                    color: isLatest ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontFamily: isAction ? 'var(--font-sans)' : 'var(--font-mono)',
                    borderLeft: `2px solid ${getColor(activeAgent)}`,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word', transition: 'all 0.2s',
                  }}>{thought}</div>;
                })
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 产物面板 */}
          {showArtifact && agentArtifacts[showArtifact] && (
            <div style={{ ...s.panel, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '12px var(--space-4)', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{getLabel(showArtifact)} 产物</span>
                <button onClick={() => setShowArtifact(null)} style={{ background: 'none', border: 'none', color: 'var(--text-quaternary)', cursor: 'pointer', fontSize: '16px', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-quaternary)'; }}>✕</button>
              </div>
              {showArtifact === 'doc' || showArtifact === 'tech' ? (
                <MarkdownView
                  content={typeof agentArtifacts[showArtifact] === 'string' ? agentArtifacts[showArtifact] : String(agentArtifacts[showArtifact])}
                  maxHeight="420px"
                />
              ) : (
                <SolidityViewer
                  code={typeof agentArtifacts[showArtifact] === 'string' ? agentArtifacts[showArtifact] : String(agentArtifacts[showArtifact])}
                  filename={showArtifact === 'dev' ? 'contract.sol' : 'frontend.tsx'}
                  maxHeight="420px"
                />
              )}
            </div>
          )}
        </div>

        {/* 产物按钮 */}
        <div style={{ display: 'flex', gap: '10px', marginTop: 'var(--space-5)', justifyContent: 'center', flexWrap: 'wrap' }}>
          {['doc','tech','dev','ui'].map(a => {
            const st = agentStatuses.find(s => s.agent === a);
            if (!agentArtifacts[a] || st?.status !== 'completed') return null;
            return <button key={a} onClick={() => setShowArtifact(showArtifact === a ? null : a)}
              style={{ ...s.btnSmall, background: showArtifact === a ? 'var(--gradient-subtle)' : 'var(--bg-panel)', color: showArtifact === a ? 'var(--accent)' : 'var(--text-tertiary)', borderColor: showArtifact === a ? 'var(--accent-ring)' : 'var(--border-subtle)', fontWeight: 500, padding: '8px 16px' }}
              onMouseEnter={(e) => { if (showArtifact !== a) e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
              onMouseLeave={(e) => { if (showArtifact !== a) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
              {a === 'doc' ? '📄 需求文档' : a === 'tech' ? '📐 技术设计' : a === 'dev' ? '⚙️ 合约代码' : '🎨 前端代码'}</button>;
          })}
        </div>

        {/* 事件日志 */}
        <div style={{ marginTop: 'var(--space-5)' }}>
          <details>
            <summary style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-sm)', cursor: 'pointer', padding: 'var(--space-2) 0', userSelect: 'none', fontWeight: 500 }}>事件日志 ({eventLogs.length})</summary>
            <div style={{ ...s.panel, padding: 'var(--space-3)', maxHeight: '160px', overflowY: 'auto', marginTop: '4px' }}>
              {eventLogs.length === 0 ? <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-sm)', textAlign: 'center', padding: 'var(--space-4)' }}>等待事件...</p> : (
                eventLogs.map((log, i) => (
                  <div key={log.id || i} style={{ display: 'flex', gap: '8px', padding: '3px 0', fontSize: 'var(--fs-xs)', color: 'var(--text-quaternary)', borderBottom: i < eventLogs.length - 1 ? '1px solid var(--border-subtle)' : 'none', fontFamily: 'var(--font-mono)' }}>
                    <span style={{ width: '18px', flexShrink: 0, textAlign: 'center', color: 'var(--text-tertiary)' }}>{getEventIcon(log.type)}</span>
                    <span style={{ width: '70px', flexShrink: 0, color: 'var(--text-quaternary)' }}>{formatTime(log.timestamp)}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.content || log.type}</span>
                  </div>
                ))
              )}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Demo 视图 — Tab 切换全量产物
// ============================================================
type ArtifactTab = 'demo' | 'requirement' | 'tech_design' | 'contract' | 'frontend';
const ARTIFACT_TABS: { key: ArtifactTab; label: string }[] = [
  { key: 'demo', label: '演示预览' }, { key: 'requirement', label: '需求文档' },
  { key: 'tech_design', label: '技术设计' }, { key: 'contract', label: '合约代码' },
  { key: 'frontend', label: '前端代码' },
];

function DemoView({ projectId, demoUrl, onReset, allArtifacts }: {
  projectId: string | null; demoUrl: string; onReset: () => void; allArtifacts: Record<string, any>;
}) {
  const [showShareModal, setShowShareModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ArtifactTab>('demo');
  const [fetching, setFetching] = useState(false);
  const setAllArtifacts = useStore((s) => s.setAllArtifacts);
  const copyLink = () => { copyToClipboard(demoUrl.startsWith('http') ? demoUrl : `${window.location.origin}${demoUrl}`); };

  // 进入 DemoView 时自动拉取产物（处理来自历史记录和新生成的场景）
  useEffect(() => {
    if (!projectId) return;
    // 如果已有数据但缺少合约/前端代码，重新拉取
    const hasContract = allArtifacts?.contract?.length > 0;
    const hasFrontend = allArtifacts?.frontend?.length > 0;
    if (hasContract && hasFrontend) return;

    setFetching(true);
    fetch(`${BACKEND_URL}/api/project/${projectId}/artifacts`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.artifacts) setAllArtifacts(d.artifacts); })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [projectId, allArtifacts?.contract?.length, allArtifacts?.frontend?.length, setAllArtifacts]);

  return (
    <div className="animate-slideUp">
      <div style={s.card}>
        {/* 完成状态 */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-5)' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--status-completed-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto var(--space-3)' }}>
            <span style={{ color: 'var(--status-completed)', fontSize: '22px', fontWeight: 600 }}>✓</span>
          </div>
          <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px', marginBottom: '2px' }}>生成完成</h2>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-base)' }}>智能合约 Demo 已准备就绪</p>
        </div>

        {/* Tab 导航 — 始终显示全部 Tab */}
        <div style={{ display: 'flex', gap: '0', marginBottom: 'var(--space-5)', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}>
          {ARTIFACT_TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '10px 18px', cursor: 'pointer', position: 'relative',
                  fontSize: 'var(--fs-sm)', fontWeight: isActive ? 600 : 500, transition: 'color 0.15s',
                  background: 'none', border: 'none', whiteSpace: 'nowrap',
                  color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = 'var(--text-tertiary)'; }}>
                {tab.label}
                {isActive && <span style={{ position: 'absolute', bottom: '-1px', left: '8px', right: '8px', height: '2px', background: 'var(--gradient-main)', borderRadius: '1px' }} />}
              </button>
            );
          })}
        </div>

        {/* Tab 内容 */}
        <ContentArea activeTab={activeTab} allArtifacts={allArtifacts} demoUrl={demoUrl} />

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap', marginTop: 'var(--space-5)' }}>
          <button onClick={copyLink} style={s.btnGhost}>复制链接</button>
          <button onClick={() => setShowShareModal(true)} style={s.btnGhost}>分享</button>
          <a href={demoUrl} target="_blank" rel="noopener noreferrer" style={{ ...s.btnPrimary, textDecoration: 'none' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.9'; (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.30)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>在新窗口打开</a>
          <button onClick={onReset} style={s.btnGhost}>新建项目</button>
        </div>

        {projectId && <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', ...s.panel }}>
          <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-xs)', fontFamily: 'var(--font-mono)' }}>项目 ID: {projectId}</p>
        </div>}
      </div>

      {showShareModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, animation: 'fadeIn 0.15s ease-out' }}
          onClick={() => setShowShareModal(false)}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-standard)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', maxWidth: '360px', width: '90%', boxShadow: 'var(--shadow-xl)' }}
            onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-5)' }}>分享 Demo</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <button onClick={copyLink} style={s.btnGhost}>复制链接</button>
              <button style={s.btnGhost}>分享到 Twitter</button>
              <button style={s.btnGhost}>分享到 Discord</button>
            </div>
            <div style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
              <button onClick={() => setShowShareModal(false)} style={{ ...s.btnSmall, padding: '8px 28px' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 内容区渲染
function ContentArea({ activeTab, allArtifacts, demoUrl }: { activeTab: ArtifactTab; allArtifacts: Record<string, any>; demoUrl: string }) {
  const renderMarkdown = (text: string) => (
    <div style={{ ...s.panel, padding: 0, maxHeight: '520px', display: 'flex', flexDirection: 'column' }}>
      <MarkdownView content={text} maxHeight="520px" />
    </div>
  );

  switch (activeTab) {
    case 'demo':
      return <div style={{ ...s.panel, overflow: 'hidden', padding: 0, borderRadius: 'var(--radius-lg)' }}>
        <iframe src={demoUrl} style={{ width: '100%', height: '520px', border: 'none', display: 'block' }} title="Demo" />
      </div>;
    case 'requirement': {
      const req = allArtifacts?.requirement;
      if (!req) return <EmptyTab />;
      const terms = req.terms || [];
      return renderMarkdown([`# ${req.project_name || '未命名项目'}`, `**模板**: ${req.template}  **摘要**: ${req.summary || '无'}`,
        '', `## 参与方`, req.parties ? Object.entries(req.parties).map(([k, v]) => `  - ${k}: ${v}`).join('\n') : '  无',
        '', `## 条款`, terms.map((t: any) => `  - ${t.id} [${t.type}] ${t.description} (${t.eligible})`).join('\n') || '  无',
        '', `## 可合约化条款`, (req.contractable_terms || []).join(', ') || '无',
        '', `## 待确认条款`, (req.pending_terms || []).join(', ') || '无',
      ].join('\n'));
    }
    case 'tech_design': {
      const td = allArtifacts?.tech_design;
      if (!td) return <EmptyTab />;
      const c = td.contracts || [], r = td.risks || [];
      return renderMarkdown([`# 技术设计方案`, '', `## 合约架构`, c.map((x: any) => `  - **${x.name}** (${x.type}): ${x.description}\n    方法: ${(x.functions || []).join(', ')}`).join('\n') || '  无',
        '', `## 设计模式`, (td.patterns || []).join(', ') || '无', '', `## 依赖`, (td.dependencies || []).join(', ') || '无',
        '', `## 风险评估`, r.map((x: any) => `  - ${x.type}: ${x.level} - ${x.mitigation || '无'}`).join('\n') || '  无',
      ].join('\n'));
    }
    case 'contract':
      return <CodeFilesPanel files={allArtifacts?.contract} codeType="solidity" />;
    case 'frontend':
      return <CodeFilesPanel files={allArtifacts?.frontend} codeType="generic" />;
    default:
      return <EmptyTab />;
  }
}

function EmptyTab() {
  return <div style={{ ...s.panel, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
    <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-base)' }}>暂无数据</p>
  </div>;
}

function CodeFilesPanel({ files, codeType = 'solidity' }: { files?: { filename: string; content: string }[]; codeType?: 'solidity' | 'generic' }) {
  const [sel, setSel] = useState(0);
  if (!files?.length) return <EmptyTab />;
  const current = files[Math.min(sel, files.length - 1)];
  const isSolFile = current.filename.endsWith('.sol') || codeType === 'solidity';
  return (
    <div style={{ ...s.panel, overflow: 'hidden', padding: 0, maxHeight: '520px', display: 'flex', flexDirection: 'column' }}>
      {files.length > 1 && (
        <div style={{ display: 'flex', gap: '2px', padding: '8px 12px', borderBottom: '1px solid var(--border-subtle)', overflowX: 'auto', flexWrap: 'nowrap' }}>
          {files.map((f, i) => (
            <button key={f.filename} onClick={() => setSel(i)}
              style={{ padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '12px', fontWeight: sel === i ? 600 : 400, whiteSpace: 'nowrap',
                background: sel === i ? 'var(--gradient-subtle)' : 'transparent', color: sel === i ? 'var(--accent)' : 'var(--text-tertiary)', border: 'none', transition: 'all 0.15s',
              }}>{f.filename}</button>
          ))}
        </div>
      )}
      {isSolFile ? (
        <SolidityViewer code={current.content} filename={current.filename} maxHeight="480px" />
      ) : (
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <CopyButton text={current.content} />
          </div>
          <pre style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: '1.6', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre', overflow: 'auto' }}>{current.content}</pre>
        </div>
      )}
    </div>
  );
}

// 跨上下文复制工具（兼容 HTTP + HTTPS）
function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text);
  }
  // Fallback: 创建临时 textarea
  return new Promise((resolve, reject) => {
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
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleClick = useCallback(() => {
    copyToClipboard(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [text]);
  return (
    <button onClick={handleClick}
      style={{
        padding: '3px 10px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
        fontSize: '11px', fontWeight: 500,
        color: copied ? 'var(--status-completed)' : 'var(--text-tertiary)',
        background: copied ? 'var(--status-completed-bg)' : 'transparent',
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-secondary)'; }}
      onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = 'var(--text-tertiary)'; }}
    >{copied ? '✓ 已复制' : '📋 复制'}</button>
  );
}

// ============================================================
// 历史记录视图
// ============================================================
function HistoryView({ projects, loading, onSelect, onBack }: {
  projects: any[]; loading: boolean; onSelect: (id: string) => void; onBack: () => void;
}) {
  const statusInfo = (s: string) => {
    const m: Record<string, { label: string; color: string }> = {
      completed: { label: '已完成', color: 'var(--status-completed)' },
      running: { label: '进行中', color: 'var(--status-running)' },
      pending: { label: '待处理', color: 'var(--text-quaternary)' },
      awaiting_confirmation: { label: '待确认', color: '#F59E0B' },
      error: { label: '出错', color: 'var(--status-failed)' },
    };
    return m[s] || { label: s, color: 'var(--text-quaternary)' };
  };

  return (
    <div className="animate-slideUp">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-6)' }}>
        <button onClick={onBack} style={s.btnSmall}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border-standard)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-panel)'; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>← 返回</button>
        <h2 style={{ fontSize: 'var(--fs-xl)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>历史记录</h2>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--text-quaternary)' }}><p style={{ fontSize: 'var(--fs-base)' }}>加载中...</p></div>
      ) : projects.length === 0 ? (
        <div style={{ ...s.card, textAlign: 'center', padding: 'var(--space-12)' }}>
          <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-base)', marginBottom: 'var(--space-3)' }}>暂无历史记录</p>
          <p style={{ color: 'var(--text-quaternary)', fontSize: 'var(--fs-sm)' }}>生成合约后将自动保存至此</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {projects.map((p, i) => {
            const info = statusInfo(p.status);
            return (
              <button key={p.project_id} onClick={() => onSelect(p.project_id)}
                style={{
                  ...s.btnGhost, justifyContent: 'space-between', padding: 'var(--space-4) var(--space-5)',
                  textAlign: 'left', width: '100%', borderRadius: 'var(--radius-lg)',
                  animation: `slideUp 0.3s cubic-bezier(0.16,1,0.3,1) ${i * 0.03}s both`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = 'var(--shadow-md)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-standard)'; e.currentTarget.style.boxShadow = 'none'; }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 'var(--fs-base)', marginBottom: '2px' }}>{p.name}</div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-quaternary)', fontFamily: 'var(--font-mono)' }}>
                    {p.template} · {new Date(p.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: info.color }} />
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 500, color: info.color }}>{info.label}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
