"""
AI Contract Platform - Backend API Server
后端 API 服务
"""

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import sys
import os
from pathlib import Path

# 添加 shared 和 agents 到路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'agents'))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / 'shared'))

from orchestrator.orchestrator import orchestrator
from shared.storage import storage
from shared.protocol import TEMPLATES

app = Flask(__name__)
CORS(app)

# 确保目录存在
storage.projects_dir.mkdir(parents=True, exist_ok=True)


@app.route('/')
def index():
    return jsonify({
        'status': 'ok',
        'service': 'AI Contract Platform',
        'version': '1.0.0'
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


@app.route('/api/generate', methods=['POST'])
def generate():
    """启动生成流程"""
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
    
    # 运行完整流程
    result = orchestrator.run_full_pipeline(project_id, user_input)
    
    # 添加监听器来捕获状态更新
    def handle_event(event):
        print(f"[Event] {event}")
    
    orchestrator.add_listener(handle_event)
    
    # 返回结果
    response = {
        'project_id': project_id,
        'status': 'completed' if 'confirmations' not in result else 'awaiting_confirmation',
    }
    
    if 'confirmations' in result:
        response['confirmations'] = [c.to_dict() for c in result['confirmations']]
        response['status'] = 'awaiting_confirmation'
    else:
        response['demo_url'] = result.get('demo', {}).get('demo_url', f'/demo/{project_id}')
    
    return jsonify(response)


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


@app.route('/api/project/<project_id>/confirm', methods=['POST'])
def confirm_project(project_id):
    """处理确认"""
    data = request.json
    confirmation_id = data.get('confirmation_id')
    selected = data.get('selected')
    
    if not confirmation_id or not selected:
        return jsonify({'error': 'Missing parameters'}), 400
    
    orchestrator.process_confirmation(project_id, confirmation_id, selected)
    
    # 检查是否所有确认都完成
    pending = storage.get_pending_confirmations(project_id)
    if not pending:
        # 继续流程
        result = orchestrator.run_full_pipeline(project_id, {})
        return jsonify({
            'status': 'completed',
            'demo_url': result.get('demo', {}).get('demo_url', f'/demo/{project_id}')
        })
    
    return jsonify({'status': 'awaiting_confirmation', 'remaining': len(pending)})


@app.route('/api/projects')
def list_projects():
    """列出所有项目"""
    projects = storage.list_projects()
    return jsonify({'projects': projects})


@app.route('/demo/<path:filename>')
def serve_demo(filename):
    """提供 Demo 文件"""
    return send_from_directory(
        Path(__file__).parent.parent.parent / 'storage' / 'projects',
        filename
    )


if __name__ == '__main__':
    print("=" * 50)
    print("AI Contract Platform Backend")
    print("=" * 50)
    print("Starting server on http://localhost:5000")
    print("=" * 50)
    app.run(host='0.0.0.0', port=5000, debug=True)
