"use client";

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore, Template, AgentStatus, EventLog } from '@/store';

// 模板列表
const TEMPLATES: Template[] = [
  { id: 'housing_lease', name: '住房租赁合同', description: '房东与租客之间的住房租赁协议', icon: '🏠' },
  { id: 'employment', name: '雇佣合同', description: '雇主与员工之间的雇佣协议', icon: '💼' },
  { id: 'goods_trade', name: '商品交易合同', description: '买卖双方之间的商品交易协议', icon: '🛒' },
  { id: 'custom', name: '自定义合同', description: '上传自定义合同文本或自由输入需求', icon: '📝' },
];

const BACKEND_URL = 'http://122.51.247.121:5000';

// ============================================================
// SSE 连接 Hook
// ============================================================
function useSSE(projectId: string | null, enabled: boolean) {
  const {
    updateAgentStatus, setConfirmations, setCurrentStep,
    setDemoUrl, setIsLoading, addMessage,
    addEventLog, addAgentThought, clearEventLogs,
    clearAgentThoughts, setAgentArtifact, setRequirementDoc,
    setTechDesign,
  } = useStore();

  const esRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef<number>(0);

  const connect = useCallback((pid: string) => {
    // 清理旧连接
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    clearEventLogs();
    clearAgentThoughts();
    lastEventIdRef.current = 0;

    const url = `${BACKEND_URL}/api/project/${pid}/events`;
    console.log('[SSE] Connecting to:', url);

    const es = new EventSource(url);
    esRef.current = es;

    // 通用事件处理器
    const handleEvent = (eventType: string) => (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const logEntry: EventLog = {
          id: `${eventType}-${++lastEventIdRef.current}`,
          type: eventType,
          phase: data.phase,
          content: data.content || data.message,
          timestamp: data.timestamp || Date.now(),
          data,
        };
        addEventLog(logEntry);
      } catch (e) {
        console.warn('[SSE] Parse error:', e);
      }
    };

    // 注册所有事件类型
    es.addEventListener('pipeline_started', (event) => {
      handleEvent('pipeline_started')(event);
      setIsLoading(true);
    });

    es.addEventListener('phase_started', (event) => {
      handleEvent('phase_started')(event);
      try {
        const data = JSON.parse(event.data);
        updateAgentStatus(data.phase, {
          status: 'running',
          message: data.message || '执行中...',
          progress: 50,
        });
      } catch (e) {}
    });

    es.addEventListener('agent_started', (event) => {
      handleEvent('agent_started')(event);
      try {
        const data = JSON.parse(event.data);
        updateAgentStatus(data.phase, {
          status: 'running',
          message: data.message || '启动中...',
          progress: 30,
        });
      } catch (e) {}
    });

    es.addEventListener('agent_thinking', (event) => {
      handleEvent('agent_thinking')(event);
      try {
        const data = JSON.parse(event.data);
        if (data.phase && data.content) {
          addAgentThought(data.phase, data.content);
        }
      } catch (e) {}
    });

    es.addEventListener('agent_completed', (event) => {
      handleEvent('agent_completed')(event);
      try {
        const data = JSON.parse(event.data);
        updateAgentStatus(data.phase, {
          status: 'completed',
          message: data.duration ? `完成 (${data.duration})` : '完成',
          progress: 100,
        });
      } catch (e) {}
    });

    es.addEventListener('artifact_ready', (event) => {
      handleEvent('artifact_ready')(event);
      try {
        const data = JSON.parse(event.data);
        // 根据 artifact_type 自动展示产物
        if (data.artifact_type === 'requirement') {
          fetchArtifact(pid, 'requirement');
        } else if (data.artifact_type === 'tech_design') {
          fetchArtifact(pid, 'tech_design');
        }
      } catch (e) {}
    });

    es.addEventListener('confirmations_required', (event) => {
      handleEvent('confirmations_required')(event);
      try {
        const data = JSON.parse(event.data);
        if (data.confirmations && data.confirmations.length > 0) {
          setConfirmations(data.confirmations);
          setCurrentStep(2);
          setIsLoading(false);
          // 不关闭 SSE — 保持连接存活，确认后 pipeline 继续事件会通过同一连接推送
        }
      } catch (e) {}
    });

    es.addEventListener('pipeline_continued', (event) => {
      handleEvent('pipeline_continued')(event);
      // 继续执行，重新开启 SSE 连接（由主页面逻辑处理）
    });

    es.addEventListener('pipeline_completed', (event) => {
      handleEvent('pipeline_completed')(event);
      try {
        const data = JSON.parse(event.data);
        setDemoUrl(data.demo_url || `/demo/${pid}`);
        setCurrentStep(4);
        setIsLoading(false);
        // 标记所有 agent 完成
        ['doc', 'tech', 'dev', 'ui'].forEach(a => {
          updateAgentStatus(a, { status: 'completed', message: '完成', progress: 100 });
        });
        es.close();
        esRef.current = null;
      } catch (e) {}
    });

    es.addEventListener('pipeline_error', (event) => {
      handleEvent('pipeline_error')(event);
      try {
        const data = JSON.parse(event.data);
        addMessage?.('error', `[ERROR] ${data.error || '生成失败'}`);
        setIsLoading(false);
        updateAgentStatus('orchestrator', { status: 'failed', message: data.error || '失败', progress: 0 });
        es.close();
        esRef.current = null;
      } catch (e) {}
    });

    es.addEventListener('__done__', () => {
      es.close();
      esRef.current = null;
    });

    es.onerror = (err) => {
      console.warn('[SSE] Connection error, will auto-reconnect:', err);
      // 不关闭连接 — EventSource 会自动重连
      // 只是停止 loading（如果重连后恢复会自动继续接收事件）
    };

  }, [updateAgentStatus, setConfirmations, setCurrentStep, setDemoUrl,
      setIsLoading, addMessage, addEventLog, addAgentThought,
      clearEventLogs, clearAgentThoughts]);

  // 获取 artifact 内容
  const fetchArtifact = async (pid: string, artifactType: string) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/project/${pid}/artifact/${artifactType}`);
      if (!res.ok) return;
      const data = await res.json();
      const artifactContent = data.data;

      if (artifactType === 'requirement') {
        setRequirementDoc(artifactContent);
        // 把需求文档解析成可读的产品文档，存为 agent 产物
        const docContent = formatRequirementDoc(artifactContent);
        setAgentArtifact('doc', docContent);
      } else if (artifactType === 'tech_design') {
        setTechDesign(artifactContent);
        const techContent = formatTechDesign(artifactContent);
        setAgentArtifact('tech', techContent);
      }
    } catch (e) {
      console.error(`[ARTIFACT] Failed to fetch ${artifactType}:`, e);
    }
  };

  // 对外暴露 connect 方法
  return { connect, disconnect: () => { esRef.current?.close(); esRef.current = null; }, fetchArtifact };
}

// ============================================================
// 文档格式化
// ============================================================
function formatRequirementDoc(data: any): string {
  if (!data) return '暂无数据';
  const terms = data.terms || [];
  const termText = terms.map((t: any) =>
    `  - ${t.id} [${t.type}] ${t.description} (${t.eligible})`
  ).join('\n');

  return `# ${data.project_name || '未命名项目'}

**模板**: ${data.template}
**摘要**: ${data.summary || '无'}

## 参与方
${data.parties ? Object.entries(data.parties).map(([k, v]) => `  - ${k}: ${v}`).join('\n') : '  无'}

## 条款列表
${termText || '  无'}

## 可合约化条款
${(data.contractable_terms || []).join(', ') || '无'}

## 待确认条款
${(data.pending_terms || []).join(', ') || '无'}`;
}

function formatTechDesign(data: any): string {
  if (!data) return '暂无数据';
  const contracts = data.contracts || [];
  const risks = data.risks || [];

  const contractText = contracts.map((c: any) =>
    `  - **${c.name}** (${c.type}): ${c.description}\n    方法: ${(c.functions || []).join(', ')}`
  ).join('\n');

  const riskText = risks.map((r: any) =>
    `  - ${r.type}: ${r.level} - ${r.mitigation || '无'}`
  ).join('\n');

  return `# 技术设计方案

## 合约架构
${contractText || '  无'}

## 设计模式
${(data.patterns || []).join(', ') || '无'}

## 依赖
${(data.dependencies || []).join(', ') || '无'}

## 风险评估
${riskText || '  无'}`;
}

// ============================================================
// Agent 名称与颜色
// ============================================================
function getAgentName(agent: string): string {
  const names: Record<string, string> = {
    doc: '📄 文档 Agent',
    tech: '📐 技术 Agent',
    dev: '⚙️ 开发 Agent',
    ui: '🎨 UI Agent',
  };
  return names[agent] || agent;
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    idle: '#94a3b8',
    running: '#3b82f6',
    completed: '#4ade80',
    failed: '#ef4444',
  };
  return colors[status] || '#94a3b8';
}

function getPhaseColor(phase: string): string {
  const colors: Record<string, string> = {
    doc: '#60a5fa',
    tech: '#a78bfa',
    dev: '#fbbf24',
    ui: '#34d399',
  };
  return colors[phase] || '#94a3b8';
}

function getEventIcon(type: string): string {
  const icons: Record<string, string> = {
    pipeline_started: '🚀',
    phase_started: '▶️',
    agent_started: '🤖',
    agent_thinking: '💭',
    agent_completed: '✅',
    artifact_ready: '📦',
    confirmations_required: '⚠️',
    pipeline_continued: '🔄',
    pipeline_completed: '🎉',
    pipeline_error: '❌',
  };
  return icons[type] || '•';
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour12: false });
}

// ============================================================
// 主页面
// ============================================================
export default function HomePage() {
  const {
    currentStep, setCurrentStep,
    selectedTemplate, setSelectedTemplate,
    requirementForm, updateRequirementForm,
    agentStatuses, updateAgentStatus,
    confirmations, setConfirmations, updateConfirmation,
    demoUrl, setDemoUrl,
    isLoading, setIsLoading,
    addMessage, reset,
    eventLogs, agentThoughts, agentArtifacts,
    requirementDoc,
  } = useStore();

  const [projectId, setProjectId] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sse = useSSE(projectId, sseConnected);

  // 启动生成流程
  const startGeneration = useCallback(async () => {
    setIsLoading(true);
    setCurrentStep(3);

    // 重置所有状态
    useStore.getState().clearEventLogs();
    useStore.getState().clearAgentThoughts();

    // 初始化 agent 状态
    const agents = ['doc', 'tech', 'dev', 'ui'];
    agents.forEach(agent => {
      updateAgentStatus(agent, { status: 'idle', message: '等待中...', progress: 0 });
    });
    updateAgentStatus('orchestrator', { status: 'idle', message: '等待中...', progress: 0 });

    try {
      // 调用 API 启动生成
      const response = await fetch(`${BACKEND_URL}/api/generate/nested`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: selectedTemplate?.id,
          ...requirementForm,
        }),
      });

      if (!response.ok) throw new Error('生成失败');

      const data = await response.json();
      console.log('[START] Generation started:', data);

      const pid = data.project_id;
      setProjectId(pid);

      // 建立 SSE 连接
      if (pid) {
        sse.connect(pid);
        setSseConnected(true);
      }

    } catch (error) {
      console.error('[START] Error:', error);
      addMessage?.('error', '[ERROR] 后端服务不可用');
      setIsLoading(false);
    }
  }, [selectedTemplate, requirementForm, updateAgentStatus, setCurrentStep, setIsLoading, addMessage, sse]);

  // 处理确认
  const handleConfirmation = useCallback(async (confirmationId: string, selected: string) => {
    updateConfirmation(confirmationId, selected);

    if (projectId) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/project/${projectId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmation_id: confirmationId,
            selected: selected
          }),
        });

        if (!response.ok) throw new Error('确认失败');

        const data = await response.json();
        console.log('[CONFIRM]', data);

        if (data.status === 'continuing') {
          // 所有确认完成，切换到生成视图
          setCurrentStep(3);
          // 重置 agent 状态，准备显示 Dev + UI
          ['dev', 'ui'].forEach(agent => {
            updateAgentStatus(agent, { status: 'idle', message: '等待中...', progress: 0 });
          });
          setIsLoading(true);
          // 不重连 SSE — 连接仍存活，后续事件（pipeline_continued 等）会自动收到
        }
      } catch (error) {
        console.error('[CONFIRM] Error:', error);
      }
    }
  }, [projectId, updateConfirmation, setIsLoading, sse]);

  // 重置
  const handleReset = useCallback(() => {
    sse.disconnect();
    setSseConnected(false);
    reset();
    setProjectId(null);
  }, [sse, reset]);

  return (
    <div style={{ minHeight: '100vh', padding: '40px 20px' }}>
      {/* Header */}
      <header style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{
          fontSize: '32px', fontWeight: 'bold', marginBottom: '8px',
          background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          🤖 AI 合约智能体
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '16px' }}>
          全链路自动化智能合约开发平台
        </p>
        {sseConnected && projectId && (
          <p style={{ color: '#4ade80', fontSize: '12px', marginTop: '4px' }}>
            ● SSE 实时连接中
          </p>
        )}
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {currentStep === 0 && (
          <TemplateSelector
            templates={TEMPLATES}
            onSelect={(template) => {
              setSelectedTemplate(template);
              setCurrentStep(1);
            }}
          />
        )}

        {currentStep === 1 && selectedTemplate && (
          <RequirementForm
            template={selectedTemplate}
            formData={requirementForm}
            onUpdate={updateRequirementForm}
            onBack={() => setCurrentStep(0)}
            onSubmit={() => startGeneration()}
          />
        )}

        {currentStep === 2 && (
          <ConfirmationView
            confirmations={confirmations}
            onConfirm={handleConfirmation}
            onBack={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <GenerationView
            agentStatuses={agentStatuses}
            eventLogs={eventLogs}
            agentThoughts={agentThoughts}
            agentArtifacts={agentArtifacts}
            isLoading={isLoading}
            projectId={projectId}
          />
        )}

        {currentStep === 4 && demoUrl && (
          <DemoView
            projectId={projectId}
            demoUrl={demoUrl}
            onReset={handleReset}
          />
        )}
      </main>
    </div>
  );
}

// ============================================================
// 模板选择组件
// ============================================================
function TemplateSelector({ templates, onSelect }: { templates: Template[]; onSelect: (t: Template) => void }) {
  return (
    <div style={{ animation: 'slideIn 0.3s ease-out' }}>
      <h2 style={{ fontSize: '24px', color: '#fff', marginBottom: '24px', textAlign: 'center' }}>
        选择合同模板
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px' }}>
        {templates.map((template) => (
          <div
            key={template.id}
            onClick={() => onSelect(template)}
            style={{
              background: 'rgba(30, 41, 59, 0.8)',
              border: '1px solid #334155',
              borderRadius: '16px',
              padding: '24px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#3b82f6';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#334155';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>{template.icon}</div>
            <h3 style={{ color: '#fff', fontSize: '18px', marginBottom: '8px' }}>{template.name}</h3>
            <p style={{ color: '#94a3b8', fontSize: '14px' }}>{template.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// 需求填写表单
// ============================================================
function RequirementForm({
  template,
  formData,
  onUpdate,
  onBack,
  onSubmit,
}: {
  template: Template;
  formData: Record<string, any>;
  onUpdate: (key: string, value: any) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const renderField = (field: any) => {
    const value = formData[field.id] || '';

    if (field.type === 'text') {
      return (
        <input
          type="text"
          value={value}
          onChange={(e) => onUpdate(field.id, e.target.value)}
          placeholder={`请输入${field.label}`}
          style={inputStyle}
        />
      );
    }

    if (field.type === 'number') {
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onUpdate(field.id, parseInt(e.target.value) || 0)}
          placeholder={`请输入${field.label}`}
          style={inputStyle}
        />
      );
    }

    if (field.type === 'date') {
      return (
        <input
          type="date"
          value={value}
          onChange={(e) => onUpdate(field.id, e.target.value)}
          style={inputStyle}
        />
      );
    }

    if (field.type === 'textarea') {
      return (
        <textarea
          value={value}
          onChange={(e) => onUpdate(field.id, e.target.value)}
          placeholder={`请输入${field.label}`}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      );
    }

    return null;
  };

  const getFields = () => {
    if (template.id === 'housing_lease') {
      return [
        { id: 'name', label: '项目名称', type: 'text' },
        { id: 'landlord', label: '房东姓名', type: 'text' },
        { id: 'tenant', label: '租客姓名', type: 'text' },
        { id: 'property', label: '房屋地址', type: 'text' },
        { id: 'monthly_rent', label: '月租金(元)', type: 'number' },
        { id: 'deposit', label: '押金(月)', type: 'number' },
        { id: 'start_date', label: '租期开始', type: 'date' },
        { id: 'end_date', label: '租期结束', type: 'date' },
        { id: 'payment_day', label: '每月租金支付日', type: 'number' },
      ];
    }
    if (template.id === 'employment') {
      return [
        { id: 'name', label: '项目名称', type: 'text' },
        { id: 'employer', label: '雇主名称', type: 'text' },
        { id: 'employee', label: '员工姓名', type: 'text' },
        { id: 'position', label: '职位', type: 'text' },
        { id: 'salary', label: '月薪(元)', type: 'number' },
        { id: 'start_date', label: '合同开始', type: 'date' },
        { id: 'end_date', label: '合同结束', type: 'date' },
      ];
    }
    if (template.id === 'goods_trade') {
      return [
        { id: 'name', label: '项目名称', type: 'text' },
        { id: 'seller', label: '卖方', type: 'text' },
        { id: 'buyer', label: '买方', type: 'text' },
        { id: 'goods', label: '商品名称', type: 'text' },
        { id: 'price', label: '总价(元)', type: 'number' },
        { id: 'delivery_date', label: '交付日期', type: 'date' },
      ];
    }
    return [
      { id: 'name', label: '项目名称', type: 'text' },
      { id: 'description', label: '需求描述', type: 'textarea' },
    ];
  };

  const fields = getFields();

  return (
    <div style={{ animation: 'slideIn 0.3s ease-out' }}>
      <button onClick={onBack} style={{ ...backButtonStyle, marginBottom: '20px' }}>
        ← 返回
      </button>

      <div style={cardStyle}>
        <div style={{ marginBottom: '24px' }}>
          <span style={{ fontSize: '32px' }}>{template.icon}</span>
          <h2 style={{ fontSize: '24px', color: '#fff', marginTop: '12px' }}>{template.name}</h2>
          <p style={{ color: '#94a3b8', marginTop: '8px' }}>{template.description}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {fields.map((field) => (
            <div key={field.id} style={{ gridColumn: field.type === 'textarea' ? '1 / -1' : undefined }}>
              <label style={{ display: 'block', color: '#94a3b8', fontSize: '14px', marginBottom: '8px' }}>
                {field.label}
              </label>
              {renderField(field)}
            </div>
          ))}
        </div>

        <button onClick={onSubmit} style={{ ...submitButtonStyle, marginTop: '32px' }}>
          🚀 开始生成
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 确认视图
// ============================================================
function ConfirmationView({
  confirmations,
  onConfirm,
  onBack,
}: {
  confirmations: any[];
  onConfirm: (id: string, selected: string) => void;
  onBack: () => void;
}) {
  return (
    <div style={{ animation: 'slideIn 0.3s ease-out' }}>
      <button onClick={onBack} style={{ ...backButtonStyle, marginBottom: '20px' }}>
        ← 返回修改
      </button>

      <div style={cardStyle}>
        <h2 style={{ fontSize: '24px', color: '#fff', marginBottom: '24px' }}>
          ⚠️ 需要您确认以下事项
        </h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {confirmations.map((conf) => (
            <div
              key={conf.id}
              style={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: '12px',
                padding: '20px',
              }}
            >
              <h3 style={{ color: '#fbbf24', fontSize: '16px', marginBottom: '8px' }}>{conf.title}</h3>
              <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '16px' }}>{conf.description}</p>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {conf.options.map((option: string) => (
                  <button
                    key={option}
                    onClick={() => onConfirm(conf.id, option)}
                    style={{
                      padding: '8px 20px',
                      background: conf.selected === option ? '#3b82f6' : '#1e293b',
                      color: '#fff',
                      border: `1px solid ${conf.selected === option ? '#3b82f6' : '#475569'}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 生成中视图 - 核心重写：实时思考 + 产物展示
// ============================================================
function GenerationView({
  agentStatuses,
  eventLogs,
  agentThoughts,
  agentArtifacts,
  isLoading,
  projectId,
}: {
  agentStatuses: AgentStatus[];
  eventLogs: EventLog[];
  agentThoughts: Record<string, string[]>;
  agentArtifacts: Record<string, any>;
  isLoading: boolean;
  projectId: string | null;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [activeAgent, setActiveAgent] = useState<string>('doc');
  const [showArtifact, setShowArtifact] = useState<string | null>(null);

  // 自动滚动到最新日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [eventLogs]);

  // 自动切换到正在运行的 agent
  useEffect(() => {
    const running = agentStatuses.find(a =>
      a.agent !== 'orchestrator' && a.status === 'running'
    );
    if (running) {
      setActiveAgent(running.agent);
    }
  }, [agentStatuses]);

  return (
    <div style={{ animation: 'slideIn 0.3s ease-out' }}>
      <div style={{ ...cardStyle, marginBottom: '20px' }}>
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '24px', color: '#fff', marginBottom: '8px' }}>AI 正在生成中...</h2>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>实时展示每个 Agent 的思考过程和生成产物</p>
          {isLoading && <p style={{ color: '#4ade80', fontSize: '12px', marginTop: '8px' }}>● SSE 实时传输中</p>}
        </div>

        {/* Agent 状态栏 */}
        <div style={{
          display: 'flex', gap: '12px', marginBottom: '24px',
          justifyContent: 'center', flexWrap: 'wrap',
        }}>
          {agentStatuses.filter(a => a.agent !== 'orchestrator').map((status) => (
            <div
              key={status.agent}
              onClick={() => setActiveAgent(status.agent)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '8px 14px',
                background: activeAgent === status.agent ? 'rgba(59, 130, 246, 0.15)' : '#0f172a',
                border: `1px solid ${activeAgent === status.agent ? '#3b82f6' : '#334155'}`,
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                minWidth: '120px',
              }}
            >
              <div style={{
                width: '10px', height: '10px', borderRadius: '50%',
                background: getStatusColor(status.status),
                boxShadow: status.status === 'running'
                  ? '0 0 8px rgba(59, 130, 246, 0.6)'
                  : 'none',
              }} />
              <span style={{ color: '#fff', fontSize: '13px', fontWeight: '500' }}>
                {getAgentName(status.agent)}
              </span>
              {status.status === 'completed' && <span style={{ color: '#4ade80', fontSize: '12px' }}>✓</span>}
              {status.status === 'failed' && <span style={{ color: '#ef4444', fontSize: '12px' }}>✗</span>}
            </div>
          ))}
        </div>

        {/* 主布局：左侧思考日志 + 右侧产物预览 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: showArtifact ? '1fr 1fr' : '1fr',
          gap: '16px',
          minHeight: '400px',
        }}>
          {/* 左侧：实时思考日志 */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            border: '1px solid #1e293b',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #1e293b',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>
                💭 {getAgentName(activeAgent)} 思考过程
              </span>
              <span style={{ color: '#64748b', fontSize: '11px' }}>
                {(agentThoughts[activeAgent] || []).length} 条
              </span>
            </div>
            <div style={{
              flex: 1, overflowY: 'auto', padding: '12px',
              maxHeight: '450px',
            }}>
              {(agentThoughts[activeAgent] || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
                  <p style={{ fontSize: '14px' }}>{getAgentName(activeAgent)} 等待执行中...</p>
                </div>
              ) : (
                (agentThoughts[activeAgent] || []).map((thought, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '6px 10px',
                      marginBottom: '4px',
                      borderRadius: '6px',
                      background: i === (agentThoughts[activeAgent] || []).length - 1
                        ? 'rgba(59, 130, 246, 0.08)'
                        : 'transparent',
                    fontSize: thought.startsWith('正在') || thought.startsWith('✅') ? '14px' : '12px',
                    lineHeight: thought.startsWith('正在') || thought.startsWith('✅') ? '1.6' : '1.4',
                    color: i === (agentThoughts[activeAgent] || []).length - 1
                      ? '#e2e8f0'
                      : '#94a3b8',
                    fontFamily: thought.startsWith('正在') || thought.startsWith('✅')
                      ? undefined
                      : 'ui-monospace, monospace',
                      borderLeft: `3px solid ${getPhaseColor(activeAgent)}${i === (agentThoughts[activeAgent] || []).length - 1 ? '80' : '20'}`,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {thought}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 右侧：产物预览（点击显示） */}
          {showArtifact && agentArtifacts[showArtifact] && (
            <div style={{
              background: '#0f172a',
              borderRadius: '12px',
              border: '1px solid #1e293b',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #1e293b',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: '500' }}>
                  📦 {getAgentName(showArtifact)} 产物
                </span>
                <button
                  onClick={() => setShowArtifact(null)}
                  style={{
                    background: 'none', border: 'none', color: '#64748b',
                    cursor: 'pointer', fontSize: '13px',
                  }}
                >
                  ✕ 关闭
                </button>
              </div>
              <div style={{
                flex: 1, overflow: 'auto', padding: '16px',
                maxHeight: '450px',
              }}>
                <pre style={{
                  margin: 0, fontSize: '12px', lineHeight: '1.6',
                  color: '#cbd5e1', fontFamily: 'ui-monospace, monospace',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {agentArtifacts[showArtifact]}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Agent 产物按钮 */}
        <div style={{
          display: 'flex', gap: '10px', marginTop: '16px',
          justifyContent: 'center', flexWrap: 'wrap',
        }}>
          {['doc', 'tech', 'dev', 'ui'].map(agent => {
            const status = agentStatuses.find(s => s.agent === agent);
            const hasArtifact = agentArtifacts[agent];
            if (!hasArtifact || status?.status !== 'completed') return null;
            return (
              <button
                key={agent}
                onClick={() => setShowArtifact(showArtifact === agent ? null : agent)}
                style={{
                  padding: '8px 16px',
                  background: showArtifact === agent ? '#1e40af' : '#1e293b',
                  color: '#fff',
                  border: `1px solid ${showArtifact === agent ? '#3b82f6' : '#334155'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: '500',
                  transition: 'all 0.2s',
                }}
              >
                📄 查看{agent === 'doc' ? '需求文档' : agent === 'tech' ? '技术设计' : agent === 'dev' ? '合约代码' : '前端代码'}
              </button>
            );
          })}
        </div>

        {/* 事件日志时间线（紧凑显示） */}
        <div style={{ marginTop: '20px' }}>
          <details>
            <summary style={{
              color: '#94a3b8', fontSize: '13px', cursor: 'pointer',
              padding: '8px 0', userSelect: 'none',
            }}>
              📋 事件日志 ({eventLogs.length} 条)
            </summary>
            <div style={{
              background: '#0f172a',
              borderRadius: '8px',
              border: '1px solid #1e293b',
              padding: '12px',
              maxHeight: '200px',
              overflowY: 'auto',
              marginTop: '8px',
            }}>
              {eventLogs.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', padding: '12px' }}>
                  等待事件...
                </p>
              ) : (
                eventLogs.map((log, i) => (
                  <div key={log.id || i} style={{
                    display: 'flex', gap: '8px', padding: '3px 0',
                    fontSize: '12px', color: '#94a3b8',
                    borderBottom: i < eventLogs.length - 1 ? '1px solid rgba(30, 41, 59, 0.5)' : 'none',
                  }}>
                    <span style={{ width: '20px', flexShrink: 0, textAlign: 'center' }}>
                      {getEventIcon(log.type)}
                    </span>
                    <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '11px', width: '70px', flexShrink: 0 }}>
                      {formatTime(log.timestamp)}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.content || log.type}
                    </span>
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
// Demo 视图
// ============================================================
function DemoView({
  projectId,
  demoUrl,
  onReset,
}: {
  projectId: string | null;
  demoUrl: string;
  onReset: () => void;
}) {
  const [showShareModal, setShowShareModal] = useState(false);

  const copyLink = () => {
    navigator.clipboard.writeText(demoUrl.startsWith('http') ? demoUrl : `${window.location.origin}${demoUrl}`);
    alert('链接已复制！');
  };

  return (
    <div style={{ animation: 'slideIn 0.3s ease-out' }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🎉</div>
          <h2 style={{ fontSize: '28px', color: '#4ade80', marginBottom: '8px' }}>生成完成！</h2>
          <p style={{ color: '#94a3b8' }}>您的智能合约 Demo 已准备就绪</p>
        </div>

        {/* Demo 预览区 */}
        <div
          style={{
            background: '#0f172a',
            borderRadius: '16px',
            border: '1px solid #334155',
            overflow: 'hidden',
            marginBottom: '24px',
          }}
        >
          <iframe
            src={demoUrl}
            style={{ width: '100%', height: '500px', border: 'none' }}
            title="Demo Preview"
          />
        </div>

        {/* 操作按钮 */}
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={copyLink} style={{ ...actionButtonStyle('#10b981') }}>
            📋 复制链接
          </button>
          <button onClick={() => setShowShareModal(true)} style={{ ...actionButtonStyle('#8b5cf6') }}>
            📤 分享
          </button>
          <button onClick={onReset} style={{ ...actionButtonStyle('#6b7280') }}>
            🆕 新建项目
          </button>
          <a
            href={demoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...actionButtonStyle('#3b82f6'), textDecoration: 'none', display: 'inline-block', textAlign: 'center' }}
          >
            🔗 在新窗口打开
          </a>
        </div>

        {/* 项目信息 */}
        {projectId && (
          <div style={{ marginTop: '32px', padding: '16px', background: '#0f172a', borderRadius: '12px' }}>
            <p style={{ color: '#94a3b8', fontSize: '12px' }}>
              项目 ID: <code style={{ color: '#86efac' }}>{projectId}</code>
            </p>
          </div>
        )}
      </div>

      {/* 分享弹窗 */}
      {showShareModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowShareModal(false)}
        >
          <div
            style={{
              background: '#1e293b',
              borderRadius: '16px',
              padding: '32px',
              maxWidth: '400px',
              width: '90%',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ color: '#fff', fontSize: '18px', marginBottom: '24px' }}>分享 Demo</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button onClick={copyLink} style={shareButtonStyle}>
                📋 复制链接
              </button>
              <button style={shareButtonStyle}>
                🐦 分享到 Twitter
              </button>
              <button style={shareButtonStyle}>
                💬 分享到 Discord
              </button>
            </div>

            <button
              onClick={() => setShowShareModal(false)}
              style={{ ...backButtonStyle, marginTop: '24px', width: '100%' }}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 样式
// ============================================================
const cardStyle: React.CSSProperties = {
  background: 'rgba(30, 41, 59, 0.8)',
  border: '1px solid #334155',
  borderRadius: '16px',
  padding: '32px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: '#0f172a',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '14px',
  outline: 'none',
  transition: 'border-color 0.2s',
};

const backButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'transparent',
  color: '#94a3b8',
  border: '1px solid #334155',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
};

const submitButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '16px',
  background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
  color: '#fff',
  border: 'none',
  borderRadius: '12px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
};

const actionButtonStyle = (bg: string): React.CSSProperties => ({
  padding: '12px 24px',
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: '10px',
  fontSize: '14px',
  fontWeight: '500',
  cursor: 'pointer',
});

const shareButtonStyle: React.CSSProperties = {
  padding: '12px 20px',
  background: '#0f172a',
  color: '#fff',
  border: '1px solid #334155',
  borderRadius: '10px',
  fontSize: '14px',
  cursor: 'pointer',
  textAlign: 'left',
};
