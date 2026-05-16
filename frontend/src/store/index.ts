// 状态管理
import { create } from 'zustand';

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export interface Term {
  id: string;
  type: string;
  description: string;
  eligible: 'eligible' | 'conditional' | 'not_eligible';
  priority: string;
}

export interface ConfirmationItem {
  id: string;
  title: string;
  description: string;
  options: string[];
  selected?: string;
}

export interface AgentStatus {
  agent: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  message: string;
  progress: number;
}

export interface Artifact {
  phase: string;
  artifact_type: string;
  artifact_path: string;
  message: string;
  ready: boolean;
}

export interface CostInfo {
  total_cost: number;
  agents: Record<string, number>;
  currency: string;
}

export interface Project {
  project_id: string;
  name: string;
  template: string;
  status: string;
  created_at: string;
}

/** SSE 事件日志条目 */
export interface EventLog {
  id: string;
  type: string;
  phase?: string;
  content?: string;
  message?: string;
  timestamp: number;
  data?: any;
}

interface AppState {
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  
  selectedTemplate: Template | null;
  setSelectedTemplate: (template: Template | null) => void;
  
  requirementForm: Record<string, any>;
  setRequirementForm: (form: Record<string, any>) => void;
  updateRequirementForm: (key: string, value: any) => void;
  
  currentStep: number;
  setCurrentStep: (step: number) => void;
  
  agentStatuses: AgentStatus[];
  updateAgentStatus: (agent: string, status: Partial<AgentStatus>) => void;
  
  confirmations: ConfirmationItem[];
  setConfirmations: (items: ConfirmationItem[]) => void;
  updateConfirmation: (id: string, selected: string) => void;
  
  requirementDoc: any | null;
  setRequirementDoc: (doc: any) => void;
  
  techDesign: any | null;
  setTechDesign: (design: any) => void;
  
  demoUrl: string | null;
  setDemoUrl: (url: string) => void;
  
  projects: Project[];
  setProjects: (projects: Project[]) => void;
  
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  
  messages: Array<{ id: string; type: string; content: string; timestamp: string }>;
  addMessage: (type: string, content: string) => void;
  
  // 成果追踪
  artifacts: Artifact[];
  addArtifact: (artifact: Artifact) => void;
  setArtifactReady: (phase: string, ready: boolean) => void;
  
  // Cost 统计
  costInfo: CostInfo | null;
  setCostInfo: (info: CostInfo) => void;
  
  // SSE 事件日志
  eventLogs: EventLog[];
  addEventLog: (log: EventLog) => void;
  clearEventLogs: () => void;
  // Agent 思考过程（按 agent 分组）
  agentThoughts: Record<string, string[]>;
  addAgentThought: (agent: string, thought: string) => void;
  clearAgentThoughts: () => void;
  // 产物（按 agent 分组的文档内容）
  agentArtifacts: Record<string, any>;
  setAgentArtifact: (agent: string, artifact: any) => void;
  // 全量产物列表（从后端 /api/project/{id}/artifacts 获取）
  allArtifacts: Record<string, any>;
  setAllArtifacts: (artifacts: Record<string, any>) => void;

  reset: () => void;
}

export const useStore = create<AppState>((set) => ({
  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  
  selectedTemplate: null,
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),
  
  requirementForm: {},
  setRequirementForm: (form) => set({ requirementForm: form }),
  updateRequirementForm: (key, value) => 
    set((state) => ({
      requirementForm: { ...state.requirementForm, [key]: value }
    })),
  
  currentStep: 0,
  setCurrentStep: (step) => set({ currentStep: step }),
  
  agentStatuses: [
    { agent: 'orchestrator', status: 'idle', message: '等待开始', progress: 0 },
    { agent: 'doc', status: 'idle', message: '等待', progress: 0 },
    { agent: 'tech', status: 'idle', message: '等待', progress: 0 },
    { agent: 'dev', status: 'idle', message: '等待', progress: 0 },
    { agent: 'ui', status: 'idle', message: '等待', progress: 0 },
  ],
  updateAgentStatus: (agent, statusUpdate) =>
    set((state) => ({
      agentStatuses: state.agentStatuses.map((a) =>
        a.agent === agent ? { ...a, ...statusUpdate } : a
      ),
    })),
  
  confirmations: [],
  setConfirmations: (items) => set({ confirmations: items }),
  updateConfirmation: (id, selected) =>
    set((state) => ({
      confirmations: state.confirmations.map((c) =>
        c.id === id ? { ...c, selected } : c
      ),
    })),
  
  requirementDoc: null,
  setRequirementDoc: (doc) => set({ requirementDoc: doc }),
  
  techDesign: null,
  setTechDesign: (design) => set({ techDesign: design }),
  
  demoUrl: null,
  setDemoUrl: (url) => set({ demoUrl: url }),
  
  projects: [],
  setProjects: (projects) => set({ projects }),
  
  isLoading: false,
  setIsLoading: (loading) => set({ isLoading: loading }),
  
  messages: [],
  addMessage: (type, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: Date.now().toString(),
          type,
          content,
          timestamp: new Date().toLocaleTimeString(),
        },
      ],
    })),
  
  // 成果追踪
  artifacts: [],
  addArtifact: (artifact) =>
    set((state) => ({
      artifacts: [...state.artifacts, artifact],
    })),
  setArtifactReady: (phase, ready) =>
    set((state) => ({
      artifacts: state.artifacts.map((a) =>
        a.phase === phase ? { ...a, ready } : a
      ),
    })),
  
  // Cost 统计
  costInfo: null,
  setCostInfo: (info) => set({ costInfo: info }),
  
  // SSE 事件日志
  eventLogs: [],
  addEventLog: (log) =>
    set((state) => ({
      eventLogs: [...state.eventLogs, log],
    })),
  clearEventLogs: () => set({ eventLogs: [] }),
  
  // Agent 思考过程
  agentThoughts: {},
  addAgentThought: (agent, thought) =>
    set((state) => ({
      agentThoughts: {
        ...state.agentThoughts,
        [agent]: [...(state.agentThoughts[agent] || []), thought],
      },
    })),
  clearAgentThoughts: () => set({ agentThoughts: {} }),
  
  // 产物（按 agent 分组的文档内容）
  agentArtifacts: {},
  setAgentArtifact: (agent, artifact) =>
    set((state) => ({
      agentArtifacts: {
        ...state.agentArtifacts,
        [agent]: artifact,
      },
    })),

  // 全量产物列表
  allArtifacts: {},
  setAllArtifacts: (artifacts) => set({ allArtifacts: artifacts }),

  reset: () => set({
    currentProjectId: null,
    selectedTemplate: null,
    requirementForm: {},
    currentStep: 0,
    agentStatuses: [
      { agent: 'orchestrator', status: 'idle', message: '等待开始', progress: 0 },
      { agent: 'doc', status: 'idle', message: '等待', progress: 0 },
      { agent: 'tech', status: 'idle', message: '等待', progress: 0 },
      { agent: 'dev', status: 'idle', message: '等待', progress: 0 },
      { agent: 'ui', status: 'idle', message: '等待', progress: 0 },
    ],
    confirmations: [],
    requirementDoc: null,
    techDesign: null,
    demoUrl: null,
    projects: [],
    isLoading: false,
    messages: [],
    eventLogs: [],
    agentThoughts: {},
    agentArtifacts: {},
    allArtifacts: {},
  }),
}));
