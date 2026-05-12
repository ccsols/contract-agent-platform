#!/bin/bash

# AI Contract Platform - Launch Script

set -e

echo "======================================"
echo " AI 合约智能体 - 全链路自动化平台"
echo "======================================"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查依赖
check_dependency() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed${NC}"
        exit 1
    fi
}

echo -e "${YELLOW}检查依赖...${NC}"
check_dependency node
check_dependency npm
check_dependency python3

# 创建虚拟环境
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}创建 Python 虚拟环境...${NC}"
    python3 -m venv venv
fi

# 安装前端依赖
echo -e "${YELLOW}安装前端依赖...${NC}"
cd "$SCRIPT_DIR/frontend"
npm install

# 安装后端依赖
echo -e "${YELLOW}安装后端依赖...${NC}"
cd "$SCRIPT_DIR"
source venv/bin/activate
pip install flask flask-cors flask-sqlalchemy waitress --quiet

echo -e "${GREEN}依赖安装完成！${NC}"
echo ""
echo "======================================"
echo " 启动服务"
echo "======================================"

# 启动后端 (在后台) - 使用 Waitress 生产服务器以支持 SSE 流式输出
echo -e "${YELLOW}启动后端服务 (端口 5000, Waitress)...${NC}"
source venv/bin/activate
PYTHONPATH=. nohup python3 -c "
import sys
sys.path.insert(0, '.')
sys.path.insert(0, 'shared')
sys.path.insert(0, 'agents')
from backend_server import app
from waitress import serve
print('Starting Waitress server on http://0.0.0.0:5000')
serve(app, host='0.0.0.0', port=5000, threads=20, channel_timeout=3600)
" > backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend started (PID: $BACKEND_PID)"

# 等待后端启动
sleep 3

# 启动前端
echo -e "${YELLOW}启动前端服务 (端口 3000)...${NC}"
cd "$SCRIPT_DIR/frontend"
nohup npm run dev > frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

echo ""
echo -e "${GREEN}======================================"
echo " 服务已启动！"
echo "======================================${NC}"
echo ""
echo " 前端: http://localhost:3000"
echo " 后端: http://localhost:5000"
echo ""
echo "日志文件: backend.log, frontend.log"
echo ""
echo "按 Ctrl+C 停止所有服务，或运行 ./stop.sh"
echo ""

# 保存 PID
echo $BACKEND_PID > .backend.pid
echo $FRONTEND_PID > .frontend.pid
