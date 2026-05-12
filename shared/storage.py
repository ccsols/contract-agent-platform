"""
AI Contract Platform - Project Storage & State Management
项目存储和状态管理
"""

import json
import os
import shutil
from pathlib import Path
from typing import Dict, Optional, Any, List
from datetime import datetime
import uuid

from protocol import (
    ProjectContext, ContractRequirement, TechDesign,
    TaskStatus, Term, TermEligibility, ConfirmationItem
)


class ProjectStorage:
    """项目存储管理器"""
    
    def __init__(self, base_path: str = "~/contract-platform/storage"):
        self.base_path = Path(os.path.expanduser(base_path))
        self.projects_dir = self.base_path / "projects"
        self.outputs_dir = self.base_path / "outputs"
        self.demos_dir = self.base_path / "demos"
        
        # 确保目录存在
        for d in [self.projects_dir, self.outputs_dir, self.demos_dir]:
            d.mkdir(parents=True, exist_ok=True)
    
    def create_project(self, name: str, template: str) -> str:
        """创建新项目"""
        project_id = f"{name.lower().replace(' ', '-')}-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6]}"
        
        project_dir = self.projects_dir / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        
        # 创建项目结构
        (project_dir / "requirement").mkdir(exist_ok=True)
        (project_dir / "tech-design").mkdir(exist_ok=True)
        (project_dir / "contract").mkdir(exist_ok=True)
        (project_dir / "backend").mkdir(exist_ok=True)
        (project_dir / "frontend").mkdir(exist_ok=True)
        (project_dir / "demo").mkdir(exist_ok=True)
        
        # 初始化项目元数据
        metadata = {
            "project_id": project_id,
            "name": name,
            "template": template,
            "status": TaskStatus.PENDING.value,
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat(),
            "steps": {
                "document": {"status": "pending", "completed_at": None},
                "tech_design": {"status": "pending", "completed_at": None},
                "development": {"status": "pending", "completed_at": None},
                "ui_development": {"status": "pending", "completed_at": None},
                "demo": {"status": "pending", "completed_at": None}
            },
            "confirmations": []
        }
        
        self._save_metadata(project_id, metadata)
        
        return project_id
    
    def get_project_path(self, project_id: str) -> Path:
        """获取项目目录路径"""
        return self.projects_dir / project_id
    
    def save_requirement(self, project_id: str, requirement: ContractRequirement):
        """保存需求文档"""
        project_dir = self.get_project_path(project_id)
        
        # 保存 JSON
        req_file = project_dir / "requirement" / "requirement.json"
        with open(req_file, 'w', encoding='utf-8') as f:
            json.dump({
                "project_id": requirement.project_id,
                "project_name": requirement.project_name,
                "template": requirement.template,
                "summary": requirement.summary,
                "parties": requirement.parties,
                "terms": [t.__dict__ for t in requirement.terms],
                "contractable_terms": requirement.contractable_terms,
                "non_contractable_terms": requirement.non_contractable_terms,
                "pending_terms": requirement.pending_terms,
                "created_at": requirement.created_at
            }, f, ensure_ascii=False, indent=2, default=str)
        
        self._update_step_status(project_id, "document", "completed")
    
    def load_requirement(self, project_id: str) -> Optional[ContractRequirement]:
        """加载需求文档"""
        req_file = self.get_project_path(project_id) / "requirement" / "requirement.json"
        if not req_file.exists():
            return None
        
        with open(req_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        terms = [Term(**t) for t in data.get("terms", [])]
        
        return ContractRequirement(
            project_id=data["project_id"],
            project_name=data["project_name"],
            template=data["template"],
            summary=data["summary"],
            parties=data.get("parties", {}),
            terms=terms,
            contractable_terms=data.get("contractable_terms", []),
            non_contractable_terms=data.get("non_contractable_terms", []),
            pending_terms=data.get("pending_terms", []),
            created_at=data.get("created_at", 0)
        )
    
    def _serialize_confirmations(self, items):
        """序列化 confirmation_items，处理 dict 或 ConfirmationItem dataclass"""
        result = []
        for item in items:
            if isinstance(item, dict):
                result.append(item)
            elif hasattr(item, 'to_dict'):
                result.append(item.to_dict())
            elif hasattr(item, '__dict__'):
                # Plain dataclass - extract fields
                result.append({k: v for k, v in item.__dict__.items() if not k.startswith('_')})
            else:
                result.append(str(item))
        return result

    def save_tech_design(self, project_id: str, tech_design: TechDesign):
        """保存技术设计"""
        project_dir = self.get_project_path(project_id)
        
        design_file = project_dir / "tech-design" / "design.json"
        with open(design_file, 'w', encoding='utf-8') as f:
            json.dump({
                "project_id": tech_design.project_id,
                "contracts": tech_design.contracts,
                "patterns": tech_design.patterns,
                "dependencies": tech_design.dependencies,
                "risks": tech_design.risks,
                "confirmation_items": self._serialize_confirmations(tech_design.confirmation_items),
                "created_at": tech_design.created_at
            }, f, ensure_ascii=False, indent=2)
        
        self._update_step_status(project_id, "tech_design", "completed")
    
    def load_tech_design(self, project_id: str) -> Optional[TechDesign]:
        """加载技术设计"""
        design_file = self.get_project_path(project_id) / "tech-design" / "design.json"
        if not design_file.exists():
            return None
        
        with open(design_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # 重建 confirmation_items（包含用户选择的选项）
        confirmation_items = []
        for item_data in data.get("confirmation_items", []):
            from protocol import ConfirmationItem
            item = ConfirmationItem(
                id=item_data["id"],
                title=item_data["title"],
                description=item_data["description"],
                options=item_data["options"],
                category=item_data.get("category", "general")
            )
            item.selected = item_data.get("selected")
            confirmation_items.append(item)
        
        return TechDesign(
            project_id=data["project_id"],
            contracts=data["contracts"],
            patterns=data["patterns"],
            dependencies=data["dependencies"],
            risks=data["risks"],
            confirmation_items=confirmation_items,
            created_at=data.get("created_at", 0)
        )
    
    def save_code(self, project_id: str, component: str, code: str, filename: str):
        """保存代码文件"""
        project_dir = self.get_project_path(project_id)
        component_dir = project_dir / component
        component_dir.mkdir(exist_ok=True)
        
        file_path = component_dir / filename
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(code)
    
    def save_frontend_project(self, project_id: str, files: Dict[str, str]):
        """保存前端项目"""
        project_dir = self.get_project_path(project_id) / "frontend"
        
        for filename, content in files.items():
            file_path = project_dir / filename
            file_path.parent.mkdir(parents=True, exist_ok=True)
            # 跳过 dict 类型的 content（UI agent 可能返回嵌套结构）
            if isinstance(content, dict):
                import json as _json
                content = _json.dumps(content, ensure_ascii=False, indent=2)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(str(content) if content else '')
        
        self._update_step_status(project_id, "ui_development", "completed")
    
    def save_backend_project(self, project_id: str, files: Dict[str, str]):
        """保存后端项目"""
        project_dir = self.get_project_path(project_id) / "backend"
        
        for filename, content in files.items():
            file_path = project_dir / filename
            file_path.parent.mkdir(parents=True, exist_ok=True)
            # 跳过 dict 类型的 content
            if isinstance(content, dict):
                import json as _json
                content = _json.dumps(content, ensure_ascii=False, indent=2)
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(str(content) if content else '')
        
        self._update_step_status(project_id, "development", "completed")
    
    def save_demo_info(self, project_id: str, demo_url: str, recording_path: str = None):
        """保存 Demo 信息"""
        project_dir = self.get_project_path(project_id)
        
        demo_info = {
            "demo_url": demo_url,
            "recording_path": recording_path,
            "created_at": datetime.now().isoformat()
        }
        
        demo_file = project_dir / "demo" / "demo.json"
        with open(demo_file, 'w', encoding='utf-8') as f:
            json.dump(demo_info, f, indent=2)
        
        self._update_step_status(project_id, "demo", "completed")
    
    def add_confirmation(self, project_id: str, confirmation: ConfirmationItem):
        """添加需要确认的项目"""
        metadata = self.get_metadata(project_id)
        metadata.setdefault("confirmations", []).append(confirmation.to_dict())
        self._save_metadata(project_id, metadata)
    
    def update_confirmation(self, project_id: str, confirmation_id: str, selected: str):
        """更新确认项目"""
        # 从 tech_design 中找到并更新对应的 confirmation_item
        tech_design_path = self.get_project_path(project_id) / "tech-design" / "design.json"
        
        with open(tech_design_path, 'r', encoding='utf-8') as f:
            design_data = json.load(f)
        
        for item in design_data.get("confirmation_items", []):
            if item["id"] == confirmation_id:
                item["selected"] = selected
                break
        
        with open(tech_design_path, 'w', encoding='utf-8') as f:
            json.dump(design_data, f, indent=2, ensure_ascii=False)
    
    def get_pending_confirmations(self, project_id: str) -> List[Dict]:
        """获取待确认项目"""
        # 从 design.json 中获取 confirmation_items（因为那里存储了实际的确认状态）
        tech_design_path = self.get_project_path(project_id) / "tech-design" / "design.json"
        
        if not tech_design_path.exists():
            return []
        
        with open(tech_design_path, 'r', encoding='utf-8') as f:
            design_data = json.load(f)
        
        return [
            item for item in design_data.get("confirmation_items", [])
            if item.get("selected") is None
        ]
    
    def save_confirmations(self, project_id: str, confirmations: List):
        """保存确认项到 design.json"""
        tech_design_path = self.get_project_path(project_id) / "tech-design" / "design.json"

        if not tech_design_path.exists():
            return

        with open(tech_design_path, 'r', encoding='utf-8') as f:
            design_data = json.load(f)

        # 使用已有的序列化方法处理 dict 或 ConfirmationItem dataclass
        design_data["confirmation_items"] = self._serialize_confirmations(confirmations)

        with open(tech_design_path, 'w', encoding='utf-8') as f:
            json.dump(design_data, f, indent=2, ensure_ascii=False)

    def get_metadata(self, project_id: str) -> Dict:
        """获取项目元数据"""
        metadata_file = self.get_project_path(project_id) / "metadata.json"
        if metadata_file.exists():
            with open(metadata_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def _save_metadata(self, project_id: str, metadata: Dict):
        """保存项目元数据"""
        project_dir = self.get_project_path(project_id)
        project_dir.mkdir(parents=True, exist_ok=True)
        metadata["updated_at"] = datetime.now().isoformat()
        
        metadata_file = project_dir / "metadata.json"
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    def _update_step_status(self, project_id: str, step: str, status: str):
        """更新步骤状态"""
        metadata = self.get_metadata(project_id)
        if "steps" not in metadata:
            metadata["steps"] = {}
        metadata["steps"][step] = {
            "status": status,
            "completed_at": datetime.now().isoformat() if status == "completed" else None
        }
        self._save_metadata(project_id, metadata)
    
    def list_projects(self) -> List[Dict]:
        """列出所有项目"""
        projects = []
        for project_dir in self.projects_dir.iterdir():
            if project_dir.is_dir():
                metadata = self.get_metadata(project_dir.name)
                projects.append({
                    "project_id": project_dir.name,
                    "name": metadata.get("name", project_dir.name),
                    "template": metadata.get("template", "unknown"),
                    "status": metadata.get("status", "unknown"),
                    "created_at": metadata.get("created_at", ""),
                    "updated_at": metadata.get("updated_at", "")
                })
        return sorted(projects, key=lambda x: x.get("updated_at", ""), reverse=True)
    
    def get_project_status(self, project_id: str) -> Dict:
        """获取项目状态"""
        metadata = self.get_metadata(project_id)
        return {
            "project_id": project_id,
            "status": metadata.get("status", "unknown"),
            "steps": metadata.get("steps", {}),
            "progress": self._calculate_progress(metadata.get("steps", {}))
        }
    
    def _calculate_progress(self, steps: Dict) -> int:
        """计算进度百分比"""
        if not steps:
            return 0
        completed = sum(1 for s in steps.values() if s.get("status") == "completed")
        return int((completed / len(steps)) * 100)
    
    def update_step_status(self, project_id: str, step: str, status: str):
        """更新步骤状态"""
        metadata_file = self.get_project_path(project_id) / "metadata.json"
        
        if not metadata_file.exists():
            return
        
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        if step in metadata.get("steps", {}):
            metadata["steps"][step]["status"] = status
            from datetime import datetime
            metadata["updated_at"] = datetime.now().isoformat()
            if status == "completed":
                metadata["steps"][step]["completed_at"] = datetime.now().isoformat()
        
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
    
    def update_project_status(self, project_id: str, status: str):
        """更新项目整体状态"""
        metadata_file = self.get_project_path(project_id) / "metadata.json"
        
        if not metadata_file.exists():
            return
        
        with open(metadata_file, 'r', encoding='utf-8') as f:
            metadata = json.load(f)
        
        from datetime import datetime
        metadata["status"] = status
        metadata["updated_at"] = datetime.now().isoformat()
        
        with open(metadata_file, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)


# 全局存储实例
storage = ProjectStorage()
