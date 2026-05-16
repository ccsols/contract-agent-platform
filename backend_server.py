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
def get_all_artifacts(project_id):
    """获取项目的所有成果（含合约代码和前端代码）"""
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

    # 合约代码
    contract_dir = project_path / "contract"
    if contract_dir.exists():
        sol_files = []
        for f in contract_dir.iterdir():
            if f.is_file() and f.suffix in ('.sol', '.json', '.txt', '.py', '.ts', '.js'):
                try:
                    sol_files.append({'filename': f.name, 'content': f.read_text(encoding='utf-8')})
                except:
                    pass
        if sol_files:
            artifacts['contract'] = sol_files

    # 前端代码（递归）
    frontend_dir = project_path / "frontend"
    if frontend_dir.exists():
        frontend_files = []
        for root, _dirs, files in os.walk(str(frontend_dir)):
            for fn in files:
                fp = Path(root) / fn
                try:
                    rel_path = str(fp.relative_to(frontend_dir))
                    frontend_files.append({'filename': rel_path, 'content': fp.read_text(encoding='utf-8')})
                except:
                    pass
        if frontend_files:
            artifacts['frontend'] = frontend_files

    # 项目元数据
    metadata = storage.get_metadata(project_id)
    if metadata:
        artifacts['metadata'] = metadata

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
# OCR API - 识别合同图片/PDF，提取关键信息
# ============================================================

import tempfile

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'pdf', 'bmp', 'tiff', 'tif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/api/ocr/parse', methods=['POST'])
def ocr_parse():
    """上传合同文件（支持多张图片/PDF），OCR识别后返回结构化字段数据"""
    # 支持单文件 ('file') 和多文件 ('files')
    uploaded = request.files.getlist('files') or ([request.files['file']] if 'file' in request.files else [])
    if not uploaded:
        return jsonify({'error': '请上传文件'}), 400

    template_id = request.form.get('template', 'custom')
    all_texts = []
    temp_paths = []

    try:
        for file in uploaded:
            if not file.filename or not allowed_file(file.filename):
                continue
            with tempfile.NamedTemporaryFile(delete=False, suffix='_' + file.filename) as tmp:
                file.save(tmp.name)
                tmp_path = tmp.name
                temp_paths.append(tmp_path)

            text = extract_text_via_ocr(tmp_path)
            if text and len(text.strip()) >= 5:
                all_texts.append(text.strip())

        # 清理临时文件
        for p in temp_paths:
            try:
                os.unlink(p)
            except:
                pass

        raw_text = '\n\n'.join(all_texts)

        if not raw_text or len(raw_text.strip()) < 10:
            return jsonify({'error': '未能从文件中识别到有效文本，请确认图片清晰或包含文字'}), 400

        # 用 LLM 解析文本为结构化字段
        parsed = parse_contract_text(raw_text, template_id)

        return jsonify({
            'success': True,
            'raw_text': raw_text[:2000],
            'fields': parsed,
            'pages_processed': len(all_texts)
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        # 清理临时文件
        for p in temp_paths:
            try:
                os.unlink(p)
            except:
                pass
        return jsonify({'error': f'OCR 处理失败: {str(e)}'}), 500


def extract_text_via_ocr(filepath: str) -> str:
    """使用 qwen-vl-ocr (DashScope) 从图片中提取文字"""
    import base64
    import json
    import urllib.request
    import traceback
    import io

    DASHSCOPE_KEY = "sk-bfd976ea3cb64acaadd72169b332afad"
    DASHSCOPE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

    try:
        from PIL import Image, ImageEnhance, ImageFilter

        img = Image.open(filepath)

        # 增强图片质量：CLAHE 对比度增强 + 锐化
        try:
            import cv2
            import numpy as np
            img_rgb = np.array(img)
            gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY) if len(img_rgb.shape) == 3 else img_rgb
            # CLAHE 增强
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
            enhanced = clahe.apply(gray)
            # 锐化
            sharpen = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
            sharpened = cv2.filter2D(enhanced, -1, sharpen)
            img = Image.fromarray(sharpened)
        except ImportError:
            # 没有 OpenCV 时用 PIL 增强
            img = img.convert('L')
            img = ImageEnhance.Contrast(img).enhance(1.5)
            img = img.filter(ImageFilter.SHARPEN)

        # 如果图片太大，压缩到最大 2000px
        w, h = img.size
        if max(w, h) > 2000:
            ratio = 2000 / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format='PNG')
        img_data = buf.getvalue()

        media_type = 'image/png'
        ext = Path(filepath).suffix.lower()
        if ext in ('.jpg', '.jpeg'):
            media_type = 'image/jpeg'
        elif ext == '.webp':
            media_type = 'image/webp'

        b64 = base64.b64encode(img_data).decode()

        body = {
            "model": "qwen-vl-ocr",
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "逐字读取合同图片中的所有汉字和数字。注意：\"三\"(三横)和\"子\"(有勾)容易混淆，\"6\"和\"0\"、\"已\"和\"己\"也容易看错，请仔细辨认每笔每画。人名、日期、金额数字必须完全准确。输出原文，不要总结。"},
                    {"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{b64}"}}
                ]
            }]
        }

        req = urllib.request.Request(
            DASHSCOPE_URL,
            data=json.dumps(body).encode('utf-8'),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {DASHSCOPE_KEY}"
            }
        )

        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode())

        if 'choices' in result and len(result['choices']) > 0:
            text = result['choices'][0]['message']['content']
            return text.strip()
        return ''

    except Exception as e:
        traceback.print_exc()
        print(f"[OCR] Error: {e}", flush=True)
        return ''


def parse_contract_text(raw_text: str, template_id: str) -> dict:
    """使用 LLM 解析 OCR 文本为结构化字段数据"""
    import subprocess
    import tempfile
    import json
    import re

    # 定义不同模板的字段期望
    field_defs = {
        'housing_lease': [
            'name', 'landlord', 'tenant', 'property', 'monthly_rent',
            'deposit', 'start_date', 'end_date', 'payment_day'
        ],
        'employment': [
            'name', 'employer', 'employee', 'position', 'salary',
            'start_date', 'end_date'
        ],
        'goods_trade': [
            'name', 'seller', 'buyer', 'goods', 'price', 'delivery_date'
        ],
        'custom': ['name', 'description']
    }
    fields = field_defs.get(template_id, field_defs['custom'])

    prompt = f"""你是一名合同信息提取专家。请从以下 OCR 识别出的合同文本中提取关键信息。

目标模板: {template_id}
需要提取的字段: {', '.join(fields)}

OCR 文本:
---
{raw_text[:4000]}
---

请根据文本内容，提取对应字段的值。返回纯 JSON 对象，key 为字段名，value 为提取的值。
如果某个字段在文本中找不到对应信息，value 设为空字符串。
日期格式统一为 YYYY-MM-DD。
数字字段只返回数字。

示例输出格式:
{{"name": "张三租房合同", "landlord": "张三", "tenant": "李四", ...}}"""

    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(prompt)
        prompt_file = f.name

    try:
        result = subprocess.run(
            ['hermes', 'chat', '--profile', 'contract-doc',
             '-q', f'Read {prompt_file} and return ONLY JSON, no explanation.'],
            capture_output=True, text=True, timeout=120,
            cwd=str(Path(__file__).parent)
        )
        os.unlink(prompt_file)

        output = result.stdout.strip()
        # 提取 JSON
        json_match = re.search(r'\{.*\}', output, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
            # 只保留需要的字段
            return {k: parsed.get(k, '') for k in fields}
        return {k: '' for k in fields}
    except Exception as e:
        print(f"[OCR] LLM parse error: {e}", flush=True)
        try:
            os.unlink(prompt_file)
        except:
            pass
        return {k: '' for k in fields}


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
