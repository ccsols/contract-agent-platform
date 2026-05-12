#!/bin/bash

# AI Contract Platform - Stop Script

echo "Stopping AI Contract Platform services..."

# 读取 PID 并停止
if [ -f ".backend.pid" ]; then
    BACKEND_PID=$(cat .backend.pid)
    if kill -0 $BACKEND_PID 2>/dev/null; then
        kill $BACKEND_PID
        echo "Backend stopped (PID: $BACKEND_PID)"
    fi
    rm .backend.pid
fi

if [ -f ".frontend.pid" ]; then
    FRONTEND_PID=$(cat .frontend.pid)
    if kill -0 $FRONTEND_PID 2>/dev/null; then
        kill $FRONTEND_PID
        echo "Frontend stopped (PID: $FRONTEND_PID)"
    fi
    rm .frontend.pid
fi

echo "All services stopped."
