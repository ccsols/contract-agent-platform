"""
AI Contract Platform - Agent Communication Protocol
Agent 间通信协议定义
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from enum import Enum
import json
import time
import uuid


class AgentType(Enum):
    ORCHESTRATOR = "orchestrator"
    DOC = "doc"
    TECH = "tech"
    DEV = "dev"
    UI = "ui"


class TaskStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    WAITING_CONFIRMATION = "waiting_confirmation"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TermEligibility(Enum):
    ELIGIBLE = "eligible"           # ✅ 可合约化
    CONDITIONAL = "conditional"     # ⚠️ 条件可合约化
    NOT_ELIGIBLE = "not_eligible"   # ❌ 不可合约化


@dataclass
class Term:
    """合同条款"""
    id: str
    type: str                        # payment, time, condition, etc.
    description: str
    eligible: TermEligibility
    details: Dict[str, Any] = field(default_factory=dict)
    priority: str = "medium"          # high, medium, low
    user_feedback: Optional[str] = None


@dataclass
class ContractRequirement:
    """需求文档"""
    project_id: str
    project_name: str
    template: str                    # 模板类型
    summary: str
    parties: Dict[str, str] = field(default_factory=dict)
    terms: List[Term] = field(default_factory=list)
    contractable_terms: List[str] = field(default_factory=list)
    non_contractable_terms: List[str] = field(default_factory=list)
    pending_terms: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TechDesign:
    """技术设计方案"""
    project_id: str
    contracts: List[Dict[str, Any]]
    patterns: List[str]
    dependencies: List[str]
    risks: List[Dict[str, str]]
    confirmation_items: List[Dict[str, str]]  # 需要用户确认的项目
    created_at: float = field(default_factory=time.time)


@dataclass
class ProjectContext:
    """项目上下文 - 在 Agent 间传递"""
    project_id: str
    requirement: Optional[ContractRequirement] = None
    tech_design: Optional[TechDesign] = None
    contract_code: Optional[str] = None
    backend_code: Optional[str] = None
    frontend_code: Optional[str] = None
    demo_url: Optional[str] = None
    status: TaskStatus = TaskStatus.PENDING
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class AgentMessage:
    """Agent 间消息格式"""
    
    def __init__(
        self,
        from_agent: AgentType,
        to_agent: AgentType,
        message_type: str,
        payload: Dict[str, Any],
        project_id: Optional[str] = None
    ):
        self.id = str(uuid.uuid4())
        self.from_agent = from_agent
        self.to_agent = to_agent
        self.message_type = message_type
        self.payload = payload
        self.project_id = project_id or payload.get("project_id")
        self.timestamp = time.time()
    
    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "from": self.from_agent.value,
            "to": self.to_agent.value,
            "type": self.message_type,
            "payload": self.payload,
            "project_id": self.project_id,
            "timestamp": self.timestamp
        }
    
    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)
    
    @classmethod
    def from_dict(cls, data: Dict) -> "AgentMessage":
        return cls(
            from_agent=AgentType(data["from"]),
            to_agent=AgentType(data["to"]),
            message_type=data["type"],
            payload=data["payload"],
            project_id=data.get("project_id")
        )


class ConfirmationItem:
    """需要用户确认的项目"""
    
    def __init__(
        self,
        id: str,
        title: str,
        description: str,
        options: List[str],          # e.g., ["确认", "修改", "跳过"]
        default: str = "confirm",
        category: str = "general"
    ):
        self.id = id
        self.title = title
        self.description = description
        self.options = options
        self.default = default
        self.category = category
        self.selected: Optional[str] = None
        self.timestamp = time.time()
    
    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "options": self.options,
            "default": self.default,
            "category": self.category,
            "selected": self.selected
        }


# 消息类型定义
class MessageTypes:
    # Orchestrator -> Agent
    START_DOCUMENT = "start_document"
    START_TECH_DESIGN = "start_tech_design"
    START_DEVELOPMENT = "start_development"
    START_UI_DEVELOPMENT = "start_ui_development"
    
    # Agent -> Orchestrator
    DOCUMENT_COMPLETED = "document_completed"
    TECH_DESIGN_COMPLETED = "tech_design_completed"
    DEVELOPMENT_COMPLETED = "development_completed"
    UI_DEVELOPMENT_COMPLETED = "ui_development_completed"
    
    # Agent -> User (via Orchestrator)
    REQUEST_CONFIRMATION = "request_confirmation"
    STATUS_UPDATE = "status_update"
    ERROR = "error"
    
    # User -> Orchestrator
    USER_CONFIRMATION = "user_confirmation"
    USER_FEEDBACK = "user_feedback"


# 模板定义
TEMPLATES = {
    "housing_lease": {
        "name": "住房租赁合同",
        "description": "房东与租客之间的住房租赁协议",
        "fields": [
            {"id": "landlord", "label": "房东姓名", "type": "text", "required": True},
            {"id": "tenant", "label": "租客姓名", "type": "text", "required": True},
            {"id": "property", "label": "房屋地址", "type": "text", "required": True},
            {"id": "monthly_rent", "label": "月租金(元)", "type": "number", "required": True},
            {"id": "deposit", "label": "押金(月)", "type": "number", "required": True},
            {"id": "start_date", "label": "租期开始", "type": "date", "required": True},
            {"id": "end_date", "label": "租期结束", "type": "date", "required": True},
            {"id": "payment_day", "label": "每月租金支付日", "type": "number", "required": True},
        ],
        "default_terms": [
            {"type": "payment", "description": "租金支付", "eligible": TermEligibility.ELIGIBLE},
            {"type": "deposit", "description": "押金托管", "eligible": TermEligibility.ELIGIBLE},
            {"type": "time", "description": "租期时间锁", "eligible": TermEligibility.ELIGIBLE},
            {"type": "termination", "description": "提前解约", "eligible": TermEligibility.CONDITIONAL},
            {"type": "damage", "description": "损坏赔偿", "eligible": TermEligibility.CONDITIONAL},
        ]
    },
    "employment": {
        "name": "雇佣合同",
        "description": "雇主与员工之间的雇佣协议",
        "fields": [
            {"id": "employer", "label": "雇主名称", "type": "text", "required": True},
            {"id": "employee", "label": "员工姓名", "type": "text", "required": True},
            {"id": "position", "label": "职位", "type": "text", "required": True},
            {"id": "salary", "label": "月薪(元)", "type": "number", "required": True},
            {"id": "start_date", "label": "合同开始", "type": "date", "required": True},
            {"id": "end_date", "label": "合同结束", "type": "date", "required": True},
        ]
    },
    "goods_trade": {
        "name": "商品交易合同",
        "description": "买卖双方之间的商品交易协议",
        "fields": [
            {"id": "seller", "label": "卖方", "type": "text", "required": True},
            {"id": "buyer", "label": "买方", "type": "text", "required": True},
            {"id": "goods", "label": "商品名称", "type": "text", "required": True},
            {"id": "price", "label": "总价(元)", "type": "number", "required": True},
            {"id": "delivery_date", "label": "交付日期", "type": "date", "required": True},
        ]
    },
    "custom": {
        "name": "自定义合同",
        "description": "上传自定义合同文本或自由输入需求",
        "fields": [
            {"id": "description", "label": "需求描述", "type": "textarea", "required": True},
            {"id": "document", "label": "合同文本(可选)", "type": "file", "required": False},
        ]
    }
}
