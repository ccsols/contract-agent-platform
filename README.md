# 🤖 AI Contract Agent

**Web3 Vibe Coding Platform** — 让产品经理通过自然语言输入，自动生成智能合约 Demo。

## 架构

4-Agent 流水线：

```
用户输入 → Doc Agent → Tech Agent → Dev Agent + UI Agent (并行) → Demo
               ↓              ↓               ↓               ↓
           需求文档        技术设计        合约+后端         前端页面
```

### Agent 职责

| Agent | 模型 | 职责 |
|---|---|---|
| **Doc Agent** | MiniMax-M2.7 | 解析用户需求，提取合同条款，生成结构化需求文档 |
| **Tech Agent** | MiniMax-M2.7 | 可行性评估，合约架构设计，识别需用户确认的条款 |
| **Dev Agent** | MiniMax-M2.7 | 生成 Solidity 合约 + Python Flask 后端模拟器 |
| **UI Agent** | MiniMax-M2.7 | 生成 Next.js 前端交互页面 |

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| **前端** | Next.js 14 + React 18 + Zustand | `3000` |
| **后端** | Flask + Waitress (SSE 流式传输) | `5000` |
| **Agent** | Hermes Agent (多 Profile 隔离) | — |
| **存储** | 本地文件系统 | — |
| **通信** | REST API + SSE (Server-Sent Events) | — |

## 快速启动

```bash
# 1. 进入项目目录
cd contract-agent-platform

# 2. 启动所有服务
./start.sh

# 3. 访问前端
open http://localhost:3000
```

### 手动启动

```bash
# 后端 (Waitress 生产服务器，支持 SSE 流式)
cd contract-agent-platform
source venv/bin/activate
python3 -c "
import sys
sys.path.insert(0, '.')
sys.path.insert(0, 'shared')
sys.path.insert(0, 'agents')
from backend_server import app
from waitress import serve
serve(app, host='0.0.0.0', port=5000, threads=20, channel_timeout=3600)
"

# 前端 (另一个终端)
cd contract-agent-platform/frontend
npm run dev
```

## 项目结构

```
contract-agent-platform/
├── backend_server.py           # Flask API 入口 (SSE + Polling)
├── start.sh / stop.sh          # 启动/停止脚本
├── shared/
│   ├── protocol.py             # 数据模型 (Term, ContractRequirement, TechDesign...)
│   ├── storage.py              # 文件存储管理
│   └── events.py               # SSE 事件存储 (线程安全)
├── agents/
│   └── orchestrator/
│       ├── orchestrator.py     # 旧版 Orchestrator (含 fallback)
│       └── nested_orchestrator.py  # 新版 NestedOrchestrator (异步并行)
├── frontend/
│   └── src/
│       ├── store/index.ts      # Zustand 状态管理
│       ├── utils/socket.ts     # WebSocket (备用)
│       └── pages/
│           ├── index.tsx       # 主页面 (SSE 实时流 + 思考展示)
│           └── demo/[projectId].tsx  # Demo 交互页面
└── storage/projects/           # 生成的项目文件
```

## 工作流程

1. **选择模板** — 住房租赁/雇佣/商品交易/自定义
2. **填写需求** — 输入合同相关字段（带日期选择器）
3. **AI 生成** — 4-Agent 流水线实时展示思考过程
   - 📄 Doc Agent → 生成需求文档
   - 📐 Tech Agent → 生成技术设计
   - ⚙️ Dev Agent → 生成合约 + 后端代码
   - 🎨 UI Agent → 生成前端页面
4. **确认条款** — 对条件可合约化的条款进行选择确认
5. **Demo** — 交互式合约 Demo 页面

## 实时特性

- **SSE 实时流** — 替代传统轮询，Agent 思考过程逐行推送
- **Agent 思考日志** — 实时展示每个 Agent 的思考过程
- **产物预览** — 每个 Agent 完成即展示其产物（需求文档/技术设计/代码）
- **心跳保活** — SSE 连接自动心跳，浏览器自动重连

## 许可证

MIT
