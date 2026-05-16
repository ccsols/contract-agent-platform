# 🤖 AI Contract Agent

**Web3 Vibe Coding Platform** — 让产品经理通过自然语言输入或上传合同照片，自动生成智能合约 Demo。

## 架构

4-Agent 流水线：

```
用户输入 → Doc Agent → Tech Agent → Dev Agent + UI Agent (并行) → Demo
 OCR ↑        ↓              ↓               ↓               ↓
 照片/PDF   需求文档        技术设计        合约+后端         前端页面
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
| **OCR** | DashScope qwen-vl-ocr | — |
| **Agent** | Hermes Agent (多 Profile 隔离) | — |
| **存储** | 本地文件系统 | — |
| **通信** | REST API + SSE (Server-Sent Events) | — |

## 快速启动

```bash
# 1. 进入项目目录
cd contract-agent-platform

# 2. 一键启动所有服务
bash ctl.sh start

# 3. 查看状态
bash ctl.sh status

# 4. 访问前端
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

### 停止服务

```bash
bash ctl.sh stop
```

## OCR 合同识别

平台支持 **上传合同照片/扫描件** 自动识别关键信息填充表单：

- **引擎**: DashScope qwen-vl-ocr（阿里云百炼）
- **预处理**: CLAHE 对比度增强 + 锐化，提高识别准确率
- **形近字提示**: 针对"三/子"、"6/0"、"已/己"等易混淆字符优化
- **多页支持**: 可同时上传多张图片（Ctrl+点击多选或拖拽），自动合并所有页面文字
- **格式**: PNG / JPG / WebP / PDF
- **成本**: ≈ ¥0.007/张（7厘钱）

照片上传后，qwen-vl-ocr 逐页识别文字 → MiniMax-M2.7 解析为结构化字段 → 自动填充表单。

## 项目结构

```
contract-agent-platform/
├── backend_server.py           # Flask API 入口 (SSE + Polling + OCR)
├── ctl.sh                      # 一键启停脚本
├── shared/
│   ├── protocol.py             # 数据模型 (Term, ContractRequirement, TechDesign...)
│   ├── storage.py              # 文件存储管理
│   └── events.py               # SSE 事件存储 (线程安全)
├── agents/
│   └── orchestrator/
│       ├── orchestrator.py     # 旧版 Orchestrator (含 fallback)
│       └── nested_orchestrator.py  # NestedOrchestrator (异步 4-Agent 流水线)
├── frontend/
│   └── src/
│       ├── store/index.ts      # Zustand 状态管理
│       ├── styles/globals.css  # Future Minimalism 设计系统
│       ├── utils.ts            # 工具函数 (时间格式化等)
│       └── pages/
│           ├── index.tsx       # 主页面 (OCR上传 + SSE实时流 + 思考展示)
│           ├── _document.tsx   # Geist 字体配置
│           └── demo/[projectId].tsx  # Demo 交互页面
└── storage/projects/           # 生成的项目文件
```

## 工作流程

1. **选择模板** — 住房租赁/雇佣/商品交易/自定义
2. **填写需求** — 手动输入 或 **上传合同照片自动填充**
3. **AI 生成** — 4-Agent 流水线实时展示思考过程
   - 📄 Doc Agent → 生成需求文档
   - 📐 Tech Agent → 生成技术设计
   - ⚙️ Dev Agent → 生成合约 + 后端代码
   - 🎨 UI Agent → 生成前端页面
4. **确认条款** — 对条件可合约化的条款进行选择确认
5. **Demo** — 交互式合约 Demo 页面

## 实时特性

- **SSE 实时流** — Agent 思考过程逐行推送
- **Agent 思考日志** — 实时展示每个 Agent 的思考过程
- **产物预览** — 每个 Agent 完成即展示其产物（需求文档/技术设计/代码）
- **心跳保活** — SSE 连接自动心跳，浏览器自动重连
- **OCR 识别** — 上传合同照片自动提取关键信息（多页支持）

## 设计系统

- **风格**: Future Minimalism（未来极简）
- **配色**: 雾白 `#FAFAFA` / 纯白 `#FFFFFF` / 电光蓝 `#2563EB`
- **渐变**: 紫 `#8B5CF6` → 青 `#06B6D4`
- **字体**: Geist Sans + Geist Mono（Vercel）
- **圆角**: 锐利 2-6px（精密工具感）

## 许可证

MIT
