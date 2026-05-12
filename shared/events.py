"""
AI Contract Platform - In-Memory Event Store for SSE
实时事件存储，后台线程生产事件，SSE 端点消费事件
"""
import json
import time
import threading
from collections import defaultdict
from typing import Dict, List, Any, Optional


class EventStore:
    """线程安全的内存事件存储"""

    def __init__(self):
        self._lock = threading.Lock()
        self._events: Dict[str, list] = defaultdict(list)
        self._conditions: Dict[str, threading.Event] = {}

    def publish(self, project_id: str, event_type: str, data: Dict[str, Any]):
        """发布一条事件"""
        event = {
            "type": event_type,
            "timestamp": time.time(),
            **data
        }
        with self._lock:
            self._events[project_id].append(event)
            # 唤醒等待该 project 的 SSE 消费者
            cond = self._conditions.get(project_id)
        if cond:
            cond.set()

    def get_pending(self, project_id: str, last_index: int = 0, timeout: float = 1.0) -> tuple:
        """
        获取指定项目的最新事件。
        如果没有新事件，阻塞最多 timeout 秒。

        Returns:
            (new_events, new_index)
        """
        # 快速路径：已有新事件
        with self._lock:
            events = self._events.get(project_id, [])
            if len(events) > last_index:
                new_events = events[last_index:]
                return new_events, len(events)
            # 没有新事件，注册条件变量等待
            if project_id not in self._conditions:
                self._conditions[project_id] = threading.Event()
            cond = self._conditions[project_id]

        # 带超时等待
        cond.wait(timeout=timeout)
        cond.clear()

        with self._lock:
            events = self._events.get(project_id, [])
            new_events = events[last_index:]
            return new_events, len(events)

    def is_terminal(self, project_id: str) -> bool:
        """检查项目是否已发布终止事件"""
        terminal_types = {'pipeline_completed', 'pipeline_error'}
        with self._lock:
            events = self._events.get(project_id, [])
            return any(e['type'] in terminal_types for e in events)

    def cleanup(self, project_id: str):
        """清理项目数据"""
        with self._lock:
            self._events.pop(project_id, None)
            cond = self._conditions.pop(project_id, None)
        if cond:
            cond.set()  # 唤醒任何等待的消费者


# 全局单例
event_store = EventStore()
