/**
 * WebSocket Service - Socket.IO Client
 * 处理与后端的 WebSocket 实时通信
 */

import { io, Socket } from 'socket.io-client';

export interface GenerationStatus {
  type: string;
  agent?: string;
  phase?: string;
  status?: string;
  message?: string;
  progress?: number;
  project_id?: string;
  confirmations?: ConfirmationItem[];
  demo_url?: string;
  error?: string;
  duration?: string;
  success?: boolean;
}

export interface ConfirmationItem {
  id: string;
  title: string;
  description: string;
  options: string[];
  default: string;
  category: string;
}

type StatusCallback = (status: GenerationStatus) => void;
type ConnectedCallback = () => void;
type DisconnectedCallback = () => void;

class SocketService {
  private socket: Socket | null = null;
  private currentProjectId: string | null = null;
  private statusCallbacks: Set<StatusCallback> = new Set();
  private connectedCallbacks: Set<ConnectedCallback> = new Set();
  private disconnectedCallbacks: Set<DisconnectedCallback> = new Set();

  /**
   * 连接到 WebSocket 服务器
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }

      // 连接到后端服务器
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://122.51.247.121:5000';
      
      console.log('[Socket] Connecting to:', backendUrl);
      
      this.socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });

      this.socket.on('connect', () => {
        console.log('[Socket] Connected:', this.socket?.id);
        this.connectedCallbacks.forEach(cb => cb());
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        console.log('[Socket] Disconnected:', reason);
        this.disconnectedCallbacks.forEach(cb => cb());
      });

      this.socket.on('connect_error', (error) => {
        console.error('[Socket] Connection error:', error);
        reject(error);
      });

      // 监听通用事件
      this.socket.on('connected', (data) => {
        console.log('[Socket] Server acknowledged:', data);
      });

      // 监听生成相关事件
      this.setupGenerationListeners();
    });
  }

  /**
   * 设置生成相关事件监听
   */
  private setupGenerationListeners(): void {
    if (!this.socket) return;

    // 生成开始
    this.socket.on('generation_started', (data: GenerationStatus) => {
      console.log('[Socket] Generation started:', data);
      this.notifyStatusCallbacks(data);
    });

    // 状态更新
    this.socket.on('status_update', (data: GenerationStatus) => {
      console.log('[Socket] Status update:', data);
      this.notifyStatusCallbacks(data);
    });

    // 阶段开始 (Doc/Tech/Dev/UI 阶段启动)
    this.socket.on('phase_started', (data: GenerationStatus) => {
      console.log('[Socket] Phase started:', data);
      this.notifyStatusCallbacks(data);
    });

    // Agent 启动
    this.socket.on('agent_started', (data: GenerationStatus) => {
      console.log('[Socket] Agent started:', data);
      this.notifyStatusCallbacks(data);
    });

    // Agent 完成
    this.socket.on('agent_completed', (data: GenerationStatus) => {
      console.log('[Socket] Agent completed:', data);
      this.notifyStatusCallbacks(data);
    });

    // 流水线继续 (用于阶段间确认)
    this.socket.on('pipeline_continued', (data: GenerationStatus) => {
      console.log('[Socket] Pipeline continued:', data);
      this.notifyStatusCallbacks(data);
    });

    // 确认请求
    this.socket.on('confirmation_required', (data: GenerationStatus) => {
      console.log('[Socket] Confirmation required:', data);
      this.notifyStatusCallbacks(data);
    });

    // 生成完成
    this.socket.on('generation_completed', (data: GenerationStatus) => {
      console.log('[Socket] Generation completed:', data);
      this.notifyStatusCallbacks(data);
    });

    // 生成错误
    this.socket.on('generation_error', (data: GenerationStatus) => {
      console.error('[Socket] Generation error:', data);
      this.notifyStatusCallbacks(data);
    });
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.currentProjectId) {
      this.leaveProject(this.currentProjectId);
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  /**
   * 加入项目房间
   */
  joinProject(projectId: string): void {
    if (!this.socket?.connected) {
      console.warn('[Socket] Not connected, cannot join project');
      return;
    }

    // 先离开之前的项目房间
    if (this.currentProjectId && this.currentProjectId !== projectId) {
      this.leaveProject(this.currentProjectId);
    }

    console.log('[Socket] Joining project:', projectId);
    this.socket.emit('join_project', { project_id: projectId });
    this.currentProjectId = projectId;
  }

  /**
   * 离开项目房间
   */
  leaveProject(projectId: string): void {
    if (!this.socket?.connected) return;

    console.log('[Socket] Leaving project:', projectId);
    this.socket.emit('leave_project', { project_id: projectId });
    
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
    }
  }

  /**
   * 订阅状态更新
   */
  onStatusUpdate(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * 订阅连接成功
   */
  onConnected(callback: ConnectedCallback): () => void {
    this.connectedCallbacks.add(callback);
    return () => this.connectedCallbacks.delete(callback);
  }

  /**
   * 订阅断开连接
   */
  onDisconnected(callback: DisconnectedCallback): () => void {
    this.disconnectedCallbacks.add(callback);
    return () => this.disconnectedCallbacks.delete(callback);
  }

  /**
   * 通知所有状态回调
   */
  private notifyStatusCallbacks(status: GenerationStatus): void {
    this.statusCallbacks.forEach(cb => cb(status));
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /**
   * 获取当前项目 ID
   */
  getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }
}

// 导出单例
export const socketService = new SocketService();
export default socketService;
