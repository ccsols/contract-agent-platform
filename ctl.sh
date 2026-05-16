#!/bin/bash
# AI Contract Platform - Start/Stop/Restart
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

case "${1:-status}" in
  start)
    echo -e "${YELLOW}Starting AI Contract Platform...${NC}"
    
    # 启动后端
    echo -n "  Backend (port 5000)... "
    if ss -tlnp 2>/dev/null | grep -q :5000; then
      echo -e "${YELLOW}already running${NC}"
    else
      source venv/bin/activate
      nohup python -c "
import sys; sys.path.insert(0, 'shared'); sys.path.insert(0, 'agents')
from backend_server import app
from waitress import serve
serve(app, host='0.0.0.0', port=5000, threads=20, channel_timeout=3600)
" > backend.log 2>&1 &
      echo -e "${GREEN}started (PID $!)${NC}"
    fi
    
    # 启动前端
    echo -n "  Frontend (port 3000)... "
    if ss -tlnp 2>/dev/null | grep -q :3000; then
      echo -e "${YELLOW}already running${NC}"
    else
      cd frontend
      nohup npx next dev -p 3000 > ../frontend.log 2>&1 &
      cd ..
      echo -e "${GREEN}started (PID $!)${NC}"
    fi
    echo -e "${GREEN}Done!${NC}"
    ;;
    
  stop)
    echo -e "${YELLOW}Stopping...${NC}"
    for port in 3000 5000; do
      pids=$(ss -tlnp 2>/dev/null | grep ":$port" | grep -oP 'pid=\K[0-9]+')
      if [ -n "$pids" ]; then
        kill -9 $pids 2>/dev/null
        echo -e "  Port $port: ${RED}killed${NC}"
      else
        echo -e "  Port $port: ${YELLOW}not running${NC}"
      fi
    done
    sleep 1
    # 再清理一次 zombie
    kill -9 $(ps aux | grep 'next dev\|next-server\|waitress' | grep -v grep | awk '{print $2}') 2>/dev/null
    echo -e "${GREEN}Stopped${NC}"
    ;;
    
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
    
  status)
    echo "AI Contract Platform Status:"
    for port in 3000 5000; do
      if ss -tlnp 2>/dev/null | grep -q ":$port"; then
        echo -e "  Port $port: ${GREEN}running${NC}"
      else
        echo -e "  Port $port: ${RED}stopped${NC}"
      fi
    done
    ;;
    
  *)
    echo "Usage: $0 {start|stop|restart|status}"
    ;;
esac
