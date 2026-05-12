"""
AI Contract Platform - Backend API Server
后端 API 服务 - 轮询 + SSE 实时事件流
"""

from flask import Flask, jsonify, request, send_from_directory, Response, stream_with_context
from flask_cors import CORS
import sys
import os
from pathlib import Path
import threading
import json
from datetime import datetime
import time as time_module

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent / 'agents'))
sys.path.insert(0, str(Path(__file__).parent / 'shared'))

from orchestrator.orchestrator import orchestrator
from shared.storage import storage
from shared.protocol import TEMPLATES
from shared.events import event_store

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# 确保目录存在
storage.projects_dir.mkdir(parents=True, exist_ok=True)


@app.route('/')
def index():
    return jsonify({
        'status': 'ok',
        'service': 'AI Contract Platform',
        'version': '1.1.0',
        'transport': 'polling'
    })


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/templates')
def get_templates():
    """获取模板列表"""
    templates_list = []
    for key, value in TEMPLATES.items():
        templates_list.append({
            'id': key,
            'name': value['name'],
            'description': value['description'],
            'fields': value.get('fields', [])
        })
    return jsonify({'templates': templates_list})


# ============================================================
# 轮询接口 - 前端通过这个接口获取实时状态
# ============================================================

@app.route('/api/project/<project_id>/poll')
def poll_status(project_id):
    """
    轮询接口 - 返回项目当前状态
    前端每 2-3 秒调用一次，用于替代 WebSocket
    """
    try:
        metadata = storage.get_metadata(project_id)
        if not metadata:
            return jsonify({'error': 'Project not found'}), 404

        # 获取基本状态
        status = metadata.get('status', 'unknown')
        steps = metadata.get('steps', {})

        # 计算进度
        completed_steps = sum(1 for s in steps.values() if s.get('status') == 'completed')
        total_steps = len(steps) if steps else 4
        progress = int((completed_steps / total_steps) * 100) if total_steps > 0 else 0

        # 获取待确认项
        confirmations = storage.get_pending_confirmations(project_id)

        result = {
            'project_id': project_id,
            'status': status,
            'progress': progress,
            'steps': steps,
            'confirmations': confirmations,
            'timestamp': datetime.now().isoformat()
        }

        # 如果有错误信息
        if 'error' in metadata:
            result['error'] = metadata['error']

        # 如果有 demo_url
        if 'demo_url' in metadata:
            result['demo_url'] = metadata['demo_url']

        return jsonify(result)

    except Exception as e:
        return jsonify({'error': str(e), 'project_id': project_id}), 500


# ============================================================
# SSE 实时事件流接口 - 替代轮询，实现真正实时推送
# ============================================================

@app.route('/api/project/<project_id>/events')
def stream_events(project_id):
    """
    SSE (Server-Sent Events) 端点
    前端通过 EventSource 连接，实时接收 Agent 事件流

    事件类型:
      pipeline_started, phase_started, agent_started,
      agent_thinking, agent_completed, artifact_ready,
      confirmations_required, pipeline_completed, pipeline_error
    """
    def generate():
        # 立即发送一个注释行，在 2 秒内建立 SSE 连接
        yield ": connected\n\n"

        last_index = 0
        # 最大连接时长 30 分钟，防止无限连接
        max_duration = 30 * 60
        start_time = time_module.time()
        heartbeat_count = 0

        while True:
            # 超过最大时长断开
            if time_module.time() - start_time > max_duration:
                yield "event: __timeout__\ndata: {}\n\n"
                break

            try:
                new_events, last_index = event_store.get_pending(
                    project_id, last_index, timeout=2.0
                )

                for event in new_events:
                    # 标准 SSE 格式: "event: <type>\ndata: <json>\n\n"
                    sse_data = json.dumps(event, ensure_ascii=False, default=str)
                    yield f"event: {event['type']}\ndata: {sse_data}\n\n"

                # 如果遇到终止事件，断开连接
                if any(e['type'] in ('pipeline_completed', 'pipeline_error')
                       for e in new_events):
                    break

                # 没有新事件 → 发送心跳维持连接
                if not new_events:
                    heartbeat_count += 1
                    # 每 2 个 polling cycle (~4秒) 发一次心跳
                    if heartbeat_count % 2 == 0:
                        yield ": heartbeat\n\n"  # SSE 注释行，浏览器忽略

            except GeneratorExit:
                break
            except Exception:
                time_module.sleep(1)

        # 发送完成信号
        yield "event: __done__\ndata: {}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
    )


@app.route('/api/project/<project_id>/metadata')
def get_project_metadata(project_id):
    """获取项目元数据（轻量级）"""
    try:
        metadata = storage.get_metadata(project_id)
        if not metadata:
            return jsonify({'error': 'Project not found'}), 404
        return jsonify({'project_id': project_id, 'metadata': metadata})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ============================================================
# 生成接口
# ============================================================

@app.route('/api/generate/nested', methods=['POST'])
def generate_nested():
    """
    使用嵌套编排框架启动生成流程
    在后台线程运行，不阻塞请求
    """
    data = request.json

    project_name = data.get('name', '未命名项目')
    template = data.get('template', 'custom')

    # 创建项目
    project_id = orchestrator.create_project(project_name, template)

    # 构建用户输入
    user_input = {
        'name': project_name,
        'template': template,
        'summary': data.get('summary', ''),
        'parties': data.get('parties', {}),
        **data
    }

    # 立即返回 project_id
    response = jsonify({
        'project_id': project_id,
        'status': 'running',
        'mode': 'nested_orchestration',
        'message': 'Pipeline started. Poll /api/project/{}/poll for status updates.'.format(project_id)
    })

    # 在后台线程中运行嵌套编排 pipeline
    def run_nested_pipeline():
        from agents.orchestrator.nested_orchestrator import NestedOrchestrator

        try:
            # 更新项目状态为运行中
            storage.update_project_status(project_id, 'running')
            storage.update_step_status(project_id, 'doc', 'running')
            storage.update_step_status(project_id, 'tech', 'pending')
            storage.update_step_status(project_id, 'dev', 'pending')
            storage.update_step_status(project_id, 'ui', 'pending')

            # 创建嵌套编排器并连接事件存储
            def make_event_callback(pid):
                def callback(event):
                    event_store.publish(
                        pid,
                        event['type'],
                        {k: v for k, v in event.items() if k != 'type'}
                    )
                return callback

            nested = NestedOrchestrator(event_callback=make_event_callback(project_id))

            # 在独立线程中运行
            def run_in_thread():
                import asyncio
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    result = loop.run_until_complete(
                        nested.run_full_pipeline(project_id, user_input)
                    )

                    # 更新项目状态
                    if result.get('status') == 'awaiting_confirmation':
                        storage.update_project_status(project_id, 'awaiting_confirmation')
                        storage.save_confirmations(project_id, result.get('confirmations', []))
                    elif result.get('status') == 'completed':
                        storage.update_project_status(project_id, 'completed')
                        storage.update_step_status(project_id, 'dev', 'completed')
                        storage.update_step_status(project_id, 'ui', 'completed')
                        metadata = storage.get_metadata(project_id)
                        if metadata:
                            metadata['demo_url'] = result.get('demo_url', f'/demo/{project_id}')
                            storage._save_metadata(project_id, metadata)
                    elif result.get('status') == 'error':
                        storage.update_project_status(project_id, 'error')
                        metadata = storage.get_metadata(project_id)
                        if metadata:
                            metadata['error'] = result.get('error', 'Unknown error')
                            storage._save_metadata(project_id, metadata)

                except Exception as e:
                    print(f"[ERROR] Pipeline thread error: {e}", flush=True)
                    import traceback
                    traceback.print_exc()
                    storage.update_project_status(project_id, 'error')
                    metadata = storage.get_metadata(project_id)
                    if metadata:
                        metadata['error'] = str(e)
                        storage._save_metadata(project_id, metadata)
                finally:
                    loop.close()

            t = threading.Thread(target=run_in_thread, daemon=False)
            t.start()

        except Exception as e:
            print(f"[ERROR] Nested pipeline error: {e}", flush=True)
            import traceback
            traceback.print_exc()
            storage.update_project_status(project_id, 'error')
            metadata = storage.get_metadata(project_id)
            if metadata:
                metadata['error'] = str(e)
                storage._save_metadata(project_id, metadata)

    threading.Thread(target=run_nested_pipeline, daemon=False).start()

    return response


@app.route('/api/generate', methods=['POST'])
def generate():
    """启动生成流程（兼容旧接口）"""
    return generate_nested()


@app.route('/api/project/<project_id>/confirm', methods=['POST'])
def confirm_project(project_id):
    """处理确认并继续流水线"""
    data = request.json
    confirmation_id = data.get('confirmation_id')
    selected = data.get('selected')

    if not confirmation_id or not selected:
        return jsonify({'error': 'Missing parameters'}), 400

    # 更新确认状态
    orchestrator.process_confirmation(project_id, confirmation_id, selected)

    # 检查是否所有确认都完成
    pending = storage.get_pending_confirmations(project_id)
    if not pending:
        # 所有确认都完成了，继续流水线
        def run_continuation():
            from agents.orchestrator.nested_orchestrator import NestedOrchestrator

            print(f"[DEBUG] run_continuation started for {project_id}", flush=True)

            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                try:
                    def make_event_callback(pid):
                        def callback(event):
                            event_store.publish(
                                pid,
                                event['type'],
                                {k: v for k, v in event.items() if k != 'type'}
                            )
                        return callback

                    nested = NestedOrchestrator(event_callback=make_event_callback(project_id))
                    # 从 storage 加载已保存的数据
                    requirement = storage.load_requirement(project_id)
                    tech_design = storage.load_tech_design(project_id)

                    print(f"[DEBUG] Loaded requirement={requirement is not None}, tech_design={tech_design is not None}", flush=True)

                    # 更新状态
                    storage.update_project_status(project_id, 'running')

                    result = loop.run_until_complete(
                        nested.run_full_pipeline_after_confirmation(project_id, requirement, tech_design)
                    )

                    print(f"[DEBUG] Pipeline result: {result.get('status')}", flush=True)

                    if result.get('status') == 'completed':
                        storage.update_project_status(project_id, 'completed')
                        storage.update_step_status(project_id, 'development', 'completed')
                        storage.update_step_status(project_id, 'ui_development', 'completed')
                        storage.update_step_status(project_id, 'demo', 'completed')
                        metadata = storage.get_metadata(project_id)
                        if metadata:
                            metadata['demo_url'] = result.get('demo_url', f'/demo/{project_id}')
                            storage._save_metadata(project_id, metadata)
                    elif result.get('status') in ('partial', 'error'):
                        # partial 或 error 都标记为失败
                        storage.update_project_status(project_id, 'error')
                        metadata = storage.get_metadata(project_id)
                        if metadata:
                            error_msg = result.get('error', 'Dev/UI 阶段失败')
                            metadata['error'] = error_msg
                            storage._save_metadata(project_id, metadata)
                finally:
                    loop.close()
            except Exception as e:
                print(f"[ERROR] Continuation pipeline error: {e}", flush=True)
                import traceback
                traceback.print_exc()
                storage.update_project_status(project_id, 'error')
                metadata = storage.get_metadata(project_id)
                if metadata:
                    metadata['error'] = str(e)
                    storage._save_metadata(project_id, metadata)

        import asyncio
        threading.Thread(target=run_continuation, daemon=False).start()

        return jsonify({
            'status': 'continuing',
            'message': 'Pipeline continuing after confirmation. Poll /api/project/{}/poll for status updates.'.format(project_id)
        })

    return jsonify({'status': 'awaiting_confirmation', 'remaining': len(pending)})


@app.route('/api/projects')
def list_projects():
    """列出所有项目"""
    projects = storage.list_projects()
    return jsonify({'projects': projects})


@app.route('/api/project/<project_id>')
def get_project(project_id):
    """获取项目状态"""
    try:
        status = storage.get_project_status(project_id)
        metadata = storage.get_metadata(project_id)
        confirmations = storage.get_pending_confirmations(project_id)

        return jsonify({
            'project_id': project_id,
            'status': status,
            'metadata': metadata,
            'pending_confirmations': confirmations
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 404


# ============================================================
# Shared Simulator API - 代理到项目自己的 simulator 或返回通用状态
# ============================================================

@app.route('/api/simulate/<project_id>', methods=['GET'])
def simulate_project(project_id):
    """
    共享 simulator 端点：返回项目的合约状态
    优先使用项目自带的 simulator Flask 实例，否则返回基于 requirement 的状态
    """
    project_path = storage.get_project_path(project_id)
    if not project_path.exists():
        return jsonify({'error': 'Project not found'}), 404

    # 读取 requirement 获取基础状态
    req_file = project_path / "requirement" / "requirement.json"
    terms = []
    project_name = project_id
    template = "unknown"

    if req_file.exists():
        with open(req_file, 'r', encoding='utf-8') as f:
            req_data = json.load(f)
            project_name = req_data.get('project_name', project_name)
            template = req_data.get('template', 'unknown')
            for t in req_data.get('terms', []):
                terms.append({
                    "id": t.get("id", ""),
                    "type": t.get("type", ""),
                    "description": t.get("description", ""),
                    "eligible": t.get("eligible", "TermEligibility.NOT_ELIGIBLE"),
                    "details": t.get("details", {}),
                    "priority": t.get("priority", "medium")
                })

    # 检查项目后端是否自带 simulator（检查端口是否被占用）
    # 如果有，代理过去；否则返回本地模拟状态
    simulator_port = 5001  # 每个项目用固定端口
    try:
        import requests as _requests
        resp = _requests.get(f"http://localhost:{simulator_port}/health", timeout=1)
        if resp.status_code == 200:
            # 代理到项目自己的 simulator
            resp = _requests.get(f"http://localhost:{simulator_port}/api/simulate/{project_id}", timeout=5)
            return jsonify(resp.json())
    except Exception:
        pass

    # 返回基于 requirement 的状态（NOT_ELIGIBLE 因为是测试版本）
    return jsonify({
        "status": "NOT_ELIGIBLE",
        "parties": [],
        "terms": terms,
        "transactions": [],
        "metadata": {
            "project_id": project_id,
            "project_name": project_name,
            "template": template
        }
    })


# ============================================================
# Artifact API - 获取各阶段成果
# ============================================================

@app.route('/api/project/<project_id>/artifacts')
def get_artifacts(project_id):
    """获取项目的所有成果"""
    project_path = storage.get_project_path(project_id)
    if not project_path.exists():
        return jsonify({'error': 'Project not found'}), 404

    artifacts = {}

    # 需求文档
    req_file = project_path / "requirement" / "requirement.json"
    if req_file.exists():
        with open(req_file, 'r', encoding='utf-8') as f:
            artifacts['requirement'] = json.load(f)

    # 技术设计
    tech_file = project_path / "tech-design" / "design.json"
    if tech_file.exists():
        with open(tech_file, 'r', encoding='utf-8') as f:
            artifacts['tech_design'] = json.load(f)

    return jsonify({
        'project_id': project_id,
        'artifacts': artifacts
    })


@app.route('/api/project/<project_id>/artifact/<artifact_type>')
def get_artifact(project_id, artifact_type):
    """获取指定类型的成果"""
    project_path = storage.get_project_path(project_id)
    if not project_path.exists():
        return jsonify({'error': 'Project not found'}), 404

    artifact_map = {
        'requirement': 'requirement.json',
        'tech_design': 'design.json'
    }

    filename = artifact_map.get(artifact_type)
    if not filename:
        return jsonify({'error': 'Unknown artifact type'}), 400

    # 项目目录的 artifact_type 子目录名可能和路径名不同
    artifact_dir_map = {
        'requirement': 'requirement',
        'tech_design': 'tech-design',
    }
    actual_dir = artifact_dir_map.get(artifact_type, artifact_type)
    artifact_file = project_path / actual_dir / filename
    if not artifact_file.exists():
        return jsonify({'error': 'Artifact not found'}), 404

    with open(artifact_file, 'r', encoding='utf-8') as f:
        return jsonify({
            'project_id': project_id,
            'artifact_type': artifact_type,
            'data': json.load(f)
        })


# ============================================================
# Cost 统计 API
# ============================================================

@app.route('/api/project/<project_id>/cost', methods=['GET'])
def get_project_cost(project_id):
    """获取项目的 Cost 统计"""
    project_path = storage.get_project_path(project_id)
    if not project_path.exists():
        return jsonify({'error': 'Project not found'}), 404

    cost_file = project_path / "cost.json"
    if cost_file.exists():
        with open(cost_file, 'r', encoding='utf-8') as f:
            return jsonify(json.load(f))

    return jsonify({
        'project_id': project_id,
        'total_cost': 0,
        'agents': {},
        'currency': 'USD'
    })


@app.route('/api/project/<project_id>/cost', methods=['POST'])
def update_project_cost(project_id):
    """更新项目的 Cost 统计"""
    data = request.json

    project_path = storage.get_project_path(project_id)
    project_path.mkdir(parents=True, exist_ok=True)

    cost_file = project_path / "cost.json"

    existing = {}
    if cost_file.exists():
        with open(cost_file, 'r', encoding='utf-8') as f:
            existing = json.load(f)

    if 'agent' in data and 'cost' in data:
        agent_name = data['agent']
        if 'agents' not in existing:
            existing['agents'] = {}
        existing['agents'][agent_name] = existing['agents'].get(agent_name, 0) + data['cost']
        existing['total_cost'] = existing.get('total_cost', 0) + data['cost']
        existing['currency'] = data.get('currency', 'USD')
        existing['updated_at'] = datetime.now().isoformat()

    with open(cost_file, 'w', encoding='utf-8') as f:
        json.dump(existing, f, indent=2)

    return jsonify(existing)


# ============================================================
# 启动服务器
# ============================================================

if __name__ == '__main__':
    print("=" * 50)
    print("AI Contract Platform Backend")
    print("Transport: HTTP Polling (WebSocket removed)")
    print("=" * 50)
    print("Starting server on http://0.0.0.0:5000")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
