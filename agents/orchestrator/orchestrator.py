"""
AI Contract Platform - Orchestrator Agent
总控 Agent：协调所有子 Agent 工作流程
"""

import os
import sys
import json
import time
import subprocess
import signal
from pathlib import Path
from typing import Dict, Optional, Any, List
from dataclasses import dataclass, field
from datetime import datetime
import threading
import queue

# 添加 shared 到路径
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from shared.protocol import (
    AgentType, TaskStatus, TermEligibility, Term,
    ContractRequirement, TechDesign, ConfirmationItem,
    ProjectContext, MessageTypes, TEMPLATES
)
from shared.storage import storage


@dataclass
class AgentProcess:
    """Agent 进程管理"""
    name: str
    profile: str
    process: Optional[subprocess.Popen] = None
    status: str = "idle"  # idle, running, completed, failed
    last_output: str = ""
    error: Optional[str] = None


class OrchestratorAgent:
    """总控 Agent"""
    
    def __init__(self):
        self.storage = storage
        self.agents: Dict[str, AgentProcess] = {}
        self.current_project_id: Optional[str] = None
        self.status = "idle"
        self.event_queue = queue.Queue()
        self.listeners: List[callable] = []
        
        # 初始化 Agent 进程
        self._init_agents()
    
    def _init_agents(self):
        """初始化所有子 Agent"""
        agent_configs = {
            "doc": AgentProcess(name="Doc Agent", profile="contract-doc"),
            "tech": AgentProcess(name="Tech Agent", profile="contract-tech"),
            "dev": AgentProcess(name="Dev Agent", profile="contract-dev"),
            "ui": AgentProcess(name="UI Agent", profile="contract-ui"),
        }
        self.agents = agent_configs
    
    def add_listener(self, callback: callable):
        """添加状态变更监听器"""
        self.listeners.append(callback)
    
    def _notify_listeners(self, event: Dict):
        """通知所有监听器"""
        event["timestamp"] = datetime.now().isoformat()
        for listener in self.listeners:
            try:
                listener(event)
            except Exception as e:
                print(f"Listener error: {e}")
    
    def emit_status(self, agent: str, status: str, message: str, progress: int = 0):
        """发送状态更新"""
        event = {
            "type": "status_update",
            "agent": agent,
            "status": status,
            "message": message,
            "progress": progress
        }
        self._notify_listeners(event)
    
    def _run_hermes_agent(self, profile: str, task: str, input_data: Dict) -> Dict:
        """运行 Hermes Agent 并获取结果"""
        import re
        import tempfile
        
        # 将输入数据写入临时文件
        input_json = json.dumps(input_data, ensure_ascii=False, indent=2)
        
        # 构建提示词
        prompt = f"""{task}

输入数据:
{input_json}

请根据输入数据完成任务。只返回JSON结果，不要有其他内容。格式: {{...}}"""
        
        # 写入临时文件
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
            f.write(prompt)
            prompt_file = f.name
        
        try:
            # 运行 hermes chat
            cmd = [
                'hermes', 'chat',
                '--profile', profile,
                '-q', f'Read {prompt_file} and return ONLY JSON, no explanation.'
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minutes for complex code generation
                cwd=str(Path(__file__).parent.parent.parent)
            )
            
            output = result.stdout.strip()
            
            print(f"[DEBUG] hermes stdout length: {len(output)}, returncode: {result.returncode}")
            if result.stderr:
                print(f"[DEBUG] hermes stderr: {result.stderr[:500]}")
            
            def find_json_end(text: str, start: int) -> int:
                """从 start 位置开始，找到匹配的 JSON 结束括号（处理转义字符）"""
                depth = 0
                in_string = False
                i = start
                while i < len(text):
                    c = text[i]
                    if in_string:
                        if c == '\\' and i + 1 < len(text):
                            # 转义序列，跳过下一个字符
                            i += 2
                            continue
                        elif c == '"':
                            in_string = False
                        i += 1
                        continue
                    # 不在字符串内
                    if c == '"':
                        in_string = True
                    elif c == '{':
                        depth += 1
                    elif c == '}':
                        depth -= 1
                        if depth == 0:
                            return i + 1
                    i += 1
                return len(text)
            
            # 从 Box UI 格式中提取 JSON
            # 格式: ╭─ ⚕ Hermes ───╮ ... JSON ... ╰───────────╯
            start_marker = "╭─ ⚕ Hermes ──"
            end_marker = "╰─"
            
            start_idx = output.find(start_marker)
            if start_idx != -1:
                json_start = output.find("{", start_idx)
                if json_start != -1:
                    search_area = output[start_idx:]
                    end_marker_pos = search_area.find(end_marker)
                    if end_marker_pos != -1:
                        # 在 end_marker 之前找到匹配的 }
                        json_end = find_json_end(output, json_start)
                        # 确保 json_end 不超过 end_marker_pos
                        if json_end > start_idx + end_marker_pos:
                            json_end = start_idx + end_marker_pos
                        json_str = output[json_start:json_end]
                    else:
                        json_str = output[json_start:]
                else:
                    json_str = output
            else:
                # Fallback: 尝试去掉 markdown 代码块
                if output.startswith('```'):
                    lines = output.split('\n')
                    json_str = '\n'.join(lines[1:-1])
                else:
                    json_str = output
            
            print(f"[DEBUG] extracted json_str (first 300): {json_str[:300]}")
            print(f"[DEBUG] extracted json_str length: {len(json_str)}")
            return json.loads(json_str)
            
        except subprocess.TimeoutExpired:
            raise Exception(f"Agent {profile} timed out")
        except json.JSONDecodeError as e:
            print(f"JSON parse error for {profile}: {e}")
            print(f"Raw output (first 2000): {result.stdout[:2000]}")
            raise Exception(f"Agent {profile} returned invalid JSON")
        except Exception as e:
            print(f"Error running agent {profile}: {e}")
            raise
        finally:
            os.unlink(prompt_file)
    
    def emit_confirmation(self, confirmation: ConfirmationItem):
        """发送确认请求"""
        event = {
            "type": "request_confirmation",
            "confirmation": confirmation.to_dict()
        }
        self._notify_listeners(event)
    
    def create_project(self, name: str, template: str, initial_data: Dict = None) -> str:
        """创建新项目"""
        project_id = self.storage.create_project(name, template)
        self.current_project_id = project_id
        
        self.emit_status("orchestrator", "running", f"项目已创建: {name}", 0)
        
        return project_id
    
    def start_document_phase(self, project_id: str, user_input: Dict) -> ContractRequirement:
        """阶段1：文档化需求 - 使用 Hermes Agent"""
        self.status = "running"
        self.emit_status("doc", "running", "正在解析需求...", 10)
        
        try:
            # 调用真实的 Doc Agent
            input_data = {
                "project_id": project_id,
                "project_name": user_input.get("name", "未命名项目"),
                "template": user_input.get("template", "custom"),
                "summary": user_input.get("summary", ""),
                "parties": user_input.get("parties", {}),
                **user_input
            }
            
            result = self._run_hermes_agent("contract-doc", "分析合同需求，生成需求文档", input_data)
            
            # 解析结果
            terms = []
            for t in result.get("terms", []):
                elig_map = {"ELIGIBLE": TermEligibility.ELIGIBLE, "CONDITIONAL": TermEligibility.CONDITIONAL, "NOT_ELIGIBLE": TermEligibility.NOT_ELIGIBLE}
                terms.append(Term(
                    id=t["id"],
                    type=t["type"],
                    description=t["description"],
                    eligible=elig_map.get(t.get("eligible"), TermEligibility.CONDITIONAL),
                    details=t.get("details", {}),
                    priority=t.get("priority", "medium")
                ))
            
            requirement = ContractRequirement(
                project_id=project_id,
                project_name=result.get("project_name", user_input.get("name", "未命名项目")),
                template=result.get("template", user_input.get("template", "custom")),
                summary=result.get("summary", ""),
                parties=result.get("parties", {}),
                terms=terms,
                contractable_terms=result.get("contractable_terms", []),
                non_contractable_terms=result.get("non_contractable_terms", []),
                pending_terms=result.get("pending_terms", []),
                metadata=user_input
            )
            
        except Exception as e:
            print(f"Doc agent failed, using fallback: {e}")
            # Fallback to hardcoded logic
            requirement = self._create_requirement_fallback(project_id, user_input)
        
        # 保存需求文档
        self.storage.save_requirement(project_id, requirement)
        
        self.emit_status("doc", "completed", "需求文档已生成", 25)
        
        return requirement
    
    def _create_requirement_fallback(self, project_id: str, user_input: Dict) -> ContractRequirement:
        """Fallback: 创建需求文档（硬编码逻辑）"""
        template = user_input.get("template", "custom")
        template_config = TEMPLATES.get(template, TEMPLATES["custom"])
        
        terms = []
        term_id = 1
        
        if template == "housing_lease":
            terms.append(Term(
                id=f"T{term_id:03d}", type="payment",
                description=f"每月租金支付 {user_input.get('monthly_rent', 0)} 元",
                eligible=TermEligibility.ELIGIBLE,
                details={"amount": user_input.get("monthly_rent"), "day": user_input.get("payment_day", 1)},
                priority="high"
            ))
            term_id += 1
            terms.append(Term(
                id=f"T{term_id:03d}", type="deposit",
                description=f"押金托管 {user_input.get('deposit', 1)} 个月",
                eligible=TermEligibility.ELIGIBLE,
                details={"months": user_input.get("deposit"), "amount": user_input.get("monthly_rent")},
                priority="high"
            ))
            term_id += 1
            terms.append(Term(
                id=f"T{term_id:03d}", type="time",
                description=f"租期 {user_input.get('start_date')} 至 {user_input.get('end_date')}",
                eligible=TermEligibility.ELIGIBLE,
                details={"start": user_input.get("start_date"), "end": user_input.get("end_date")},
                priority="high"
            ))
            term_id += 1
            terms.append(Term(
                id=f"T{term_id:03d}", type="termination",
                description="提前解约条款",
                eligible=TermEligibility.CONDITIONAL,
                details={"penalty": "1个月租金"},
                priority="medium"
            ))
            term_id += 1
            terms.append(Term(
                id=f"T{term_id:03d}", type="damage",
                description="房屋损坏赔偿条款",
                eligible=TermEligibility.CONDITIONAL,
                details={"arbiter": "物业或仲裁机构"},
                priority="medium"
            ))
        else:
            terms.append(Term(
                id="T001", type="general",
                description=user_input.get("description", ""),
                eligible=TermEligibility.CONDITIONAL,
                priority="medium"
            ))
        
        return ContractRequirement(
            project_id=project_id,
            project_name=user_input.get("name", "未命名项目"),
            template=template,
            summary=user_input.get("summary", f"{template_config['name']}智能合约开发"),
            parties=user_input.get("parties", {}),
            terms=terms,
            contractable_terms=[t.id for t in terms if t.eligible == TermEligibility.ELIGIBLE],
            non_contractable_terms=[],
            pending_terms=[t.id for t in terms if t.eligible == TermEligibility.CONDITIONAL],
            metadata=user_input
        )
    
    def start_tech_design_phase(self, project_id: str, requirement: ContractRequirement) -> TechDesign:
        """阶段2：技术设计 - 使用 Hermes Agent"""
        self.emit_status("tech", "running", "正在进行可行性评估...", 30)
        
        try:
            # 调用真实的 Tech Agent
            req_dict = {
                "project_id": project_id,
                "requirement": {
                    "project_name": requirement.project_name,
                    "template": requirement.template,
                    "terms": [
                        {
                            "id": t.id,
                            "type": t.type,
                            "description": t.description,
                            "eligible": t.eligible.value if hasattr(t.eligible, 'value') else str(t.eligible),
                            "details": t.details,
                            "priority": t.priority
                        } for t in requirement.terms
                    ],
                    "contractable_terms": requirement.contractable_terms,
                    "pending_terms": requirement.pending_terms
                }
            }
            
            result = self._run_hermes_agent("contract-tech", "分析需求可行性，设计智能合约架构", req_dict)
            
            # 解析结果
            contracts = result.get("contracts", [])
            risks = result.get("risks", [])
            confirmation_items = result.get("confirmation_items", [])
            
            tech_design = TechDesign(
                project_id=project_id,
                contracts=contracts,
                patterns=result.get("patterns", []),
                dependencies=result.get("dependencies", ["@openzeppelin/contracts"]),
                risks=risks,
                confirmation_items=confirmation_items
            )
            
        except Exception as e:
            print(f"Tech agent failed, using fallback: {e}")
            # Fallback to hardcoded logic
            tech_design = self._create_tech_design_fallback(project_id, requirement)
        
        # 保存技术设计
        self.storage.save_tech_design(project_id, tech_design)
        
        self.emit_status("tech", "completed", "技术设计完成", 50)
        
        return tech_design
    
    def _create_tech_design_fallback(self, project_id: str, requirement: ContractRequirement) -> TechDesign:
        """Fallback: 创建技术设计（硬编码逻辑）"""
        contracts = []
        risks = []
        confirmation_items = []
        
        for term in requirement.terms:
            if term.eligible == TermEligibility.ELIGIBLE:
                if term.type == "payment":
                    contracts.append({
                        "name": "PaymentManager", "type": "library",
                        "description": "支付管理器",
                        "functions": ["processPayment", "schedulePayment", "getPaymentStatus"]
                    })
                elif term.type == "deposit":
                    contracts.append({
                        "name": "EscrowVault", "type": "main",
                        "description": "押金托管合约",
                        "functions": ["deposit", "release", "claim", "refund"]
                    })
                elif term.type == "time":
                    contracts.append({
                        "name": "TimeLock", "type": "library",
                        "description": "时间锁",
                        "functions": ["lock", "unlock", "extend"]
                    })
                elif term.type == "termination":
                    contracts.append({
                        "name": "TerminationManager", "type": "main",
                        "description": "解约管理",
                        "functions": ["requestTermination", "approveTermination", "executePenalty"]
                    })
        
        contracts.append({
            "name": "HousingLease" if requirement.template == "housing_lease" else "MainContract",
            "type": "main",
            "description": "主合约 - 整合所有业务逻辑",
            "functions": ["initialize", "sign", "getStatus", "terminate"]
        })
        
        risks = [
            {"type": "重入攻击", "level": "low", "mitigation": "使用 ReentrancyGuard"},
            {"type": "整数溢出", "level": "low", "mitigation": "使用 SafeMath"},
        ]
        
        for term in requirement.terms:
            if term.eligible == TermEligibility.CONDITIONAL:
                confirmation_items.append({
                    "id": f"conf_{term.id}",
                    "title": f"条款确认: {term.description}",
                    "description": f"该条款（{term.description}）为条件可合约化，需要确认处理方式",
                    "options": ["添加仲裁模块", "简化为条件判断", "移除此条款"],
                    "category": "term_confirmation"
                })
        
        return TechDesign(
            project_id=project_id,
            contracts=contracts,
            patterns=["Escrow", "StateMachine", "ReentrancyGuard"],
            dependencies=["@openzeppelin/contracts"],
            risks=risks,
            confirmation_items=confirmation_items
        )
    
    def get_confirmation_requests(self, project_id: str) -> List[ConfirmationItem]:
        """获取需要确认的项目"""
        confirmations = []
        
        # 从技术设计获取确认项
        tech_design = self.storage.load_tech_design(project_id)
        if tech_design:
            for item in tech_design.confirmation_items:
                # item 可能是 dict 或 ConfirmationItem dataclass
                if isinstance(item, dict):
                    item_id = item.get("id")
                    item_title = item.get("title")
                    item_desc = item.get("description")
                    item_options = item.get("options", [])
                    item_category = item.get("category", "general")
                    item_selected = item.get("selected")
                else:
                    item_id = item.id
                    item_title = item.title
                    item_desc = item.description
                    item_options = item.options
                    item_category = item.category if hasattr(item, 'category') else "general"
                    item_selected = item.selected if hasattr(item, 'selected') else None
                
                # 只添加尚未确认的项
                if item_selected is None:
                    confirmations.append(ConfirmationItem(
                        id=item_id,
                        title=item_title,
                        description=item_desc,
                        options=item_options,
                        category=item_category
                    ))
        
        return confirmations
    
    def process_confirmation(self, project_id: str, confirmation_id: str, selected: str):
        """处理用户确认"""
        self.storage.update_confirmation(project_id, confirmation_id, selected)
        self.emit_status("orchestrator", "running", f"已确认: {confirmation_id}", 55)
    
    def start_development_phase(self, project_id: str) -> Dict[str, str]:
        """阶段3：开发（合约 + 后端）- 使用 Hermes Agent"""
        print(f"[DEBUG] start_development_phase called for {project_id}", flush=True)
        self.emit_status("dev", "running", "正在开发合约和后端...", 60)
        
        project_dir = self.storage.get_project_path(project_id)
        requirement = self.storage.load_requirement(project_id)
        tech_design = self.storage.load_tech_design(project_id)
        
        try:
            # 获取用户确认选项
            user_confirmations = {}
            if tech_design and tech_design.confirmation_items:
                for item in tech_design.confirmation_items:
                    # item 可能是 dict 或 ConfirmationItem dataclass
                    if isinstance(item, dict):
                        item_id = item.get("id")
                        item_selected = item.get("selected")
                    else:
                        item_id = item.id
                        item_selected = item.selected if hasattr(item, 'selected') else None
                    if item_selected:
                        user_confirmations[item_id] = item_selected
            
            # 调用真实的 Dev Agent
            input_data = {
                "project_id": project_id,
                "requirement": {
                    "project_name": requirement.project_name,
                    "template": requirement.template,
                    "terms": [
                        {
                            "id": t.id,
                            "type": t.type,
                            "description": t.description,
                            "eligible": t.eligible.value if hasattr(t.eligible, 'value') else str(t.eligible),
                            "details": t.details,
                            "priority": t.priority
                        } for t in requirement.terms
                    ]
                },
                "tech_design": {
                    "contracts": tech_design.contracts if tech_design else [],
                    "patterns": tech_design.patterns if tech_design else [],
                    "dependencies": tech_design.dependencies if tech_design else [],
                    "confirmation_items": tech_design.confirmation_items if tech_design else []
                },
                "user_confirmations": user_confirmations,
                "project_path": str(project_dir)
            }
            
            result = self._run_hermes_agent("contract-dev", "生成智能合约和后端模拟器代码", input_data)
            
            print(f"[DEBUG] Dev agent result keys: {list(result.keys()) if isinstance(result, dict) else type(result)}")
            print(f"[DEBUG] Dev agent result: {str(result)[:500]}")
            
            # Dev Agent 返回的是 JSON，包含 contract 和 backend 代码
            contract_code = result.get("contract", "")
            if not contract_code:
                raise Exception("Dev agent did not return contract code")
            
            # 保存合约代码
            self.storage.save_code(project_id, "contract", contract_code, "MainContract.sol")
            
            # 保存后端代码
            backend_files = result.get("backend", {})
            if isinstance(backend_files, dict):
                self.storage.save_backend_project(project_id, backend_files)
            else:
                # 兼容旧的字符串格式
                self.storage.save_backend_project(project_id, {"server.py": backend_files})
            
            self.emit_status("dev", "completed", "合约和后端开发完成", 75)
            self.storage._update_step_status(project_id, "development", "completed")
            return {"contract": contract_code, "backend": backend_files if isinstance(backend_files, str) else str(backend_files)}
            
        except Exception as e:
            print(f"Dev agent failed: {e}")
            raise Exception(f"Dev agent failed: {e}")
    
    def start_ui_development_phase(self, project_id: str) -> Dict[str, str]:
        """阶段4：前端开发 - 使用 Hermes Agent"""
        self.emit_status("ui", "running", "正在开发前端界面...", 80)
        
        project_dir = self.storage.get_project_path(project_id)
        requirement = self.storage.load_requirement(project_id)
        tech_design = self.storage.load_tech_design(project_id)
        
        try:
            # 调用真实的 UI Agent
            input_data = {
                "project_id": project_id,
                "requirement": {
                    "project_name": requirement.project_name,
                    "template": requirement.template,
                    "parties": requirement.parties
                },
                "tech_design": {
                    "contracts": tech_design.contracts if tech_design else []
                },
                "project_path": str(project_dir)
            }
            
            result = self._run_hermes_agent("contract-ui", "生成智能合约演示前端页面", input_data)
            
            # UI Agent 应该已经创建了前端文件
            frontend_dir = project_dir / "frontend"
            if frontend_dir.exists():
                self.emit_status("ui", "completed", "前端界面开发完成", 90)
                self.storage._update_step_status(project_id, "ui_development", "completed")
                return {"frontend": "generated"}
            else:
                raise Exception("UI agent did not create frontend files")
            
        except Exception as e:
            print(f"UI agent failed, using fallback: {e}")
            # Fallback to hardcoded generation
            frontend_files = self._generate_frontend_project(requirement)
            self.storage.save_frontend_project(project_id, frontend_files)
            
            self.emit_status("ui", "completed", "前端界面开发完成", 90)
            self.storage._update_step_status(project_id, "ui_development", "completed")
            return frontend_files
    
    def finalize_demo(self, project_id: str) -> Dict:
        """阶段5：生成 Demo"""
        self.emit_status("orchestrator", "running", "正在生成 Demo...", 95)
        
        # 生成 Demo 信息
        demo_info = {
            "demo_url": f"/demo/{project_id}",
            "recording_path": None,
            "project_id": project_id
        }
        
        self.storage.save_demo_info(
            project_id, 
            demo_url=demo_info["demo_url"]
        )
        
        self.emit_status("orchestrator", "completed", "Demo 生成完成！", 100)
        self.status = "completed"
        
        return demo_info
    
    def _generate_contract_code(self, requirement: ContractRequirement, tech_design: TechDesign) -> str:
        """生成 Solidity 合约代码"""
        
        if requirement.template == "housing_lease":
            return '''// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title HousingLease
 * @dev 住房租赁合同智能合约 (Demo 模式 - 本地模拟运行)
 */
contract HousingLease {
    
    // 状态枚举
    enum ContractStatus { Created, Active, Terminated, Completed }
    enum PaymentStatus { Pending, Paid, Late, Default }
    
    // 合约状态
    ContractStatus public status;
    PaymentStatus public paymentStatus;
    
    // 当事人
    address public landlord;
    address public tenant;
    address public arbiter;  // 仲裁人
    
    // 房屋信息
    string public propertyAddress;
    
    // 财务参数
    uint256 public monthlyRent;
    uint256 public deposit;        // 押金（月数）
    uint256 public totalRent;      // 总租金
    uint256 public depositAmount;  // 押金金额
    
    // 时间参数
    uint256 public startDate;
    uint256 public endDate;
    uint256 public paymentDay;      // 每月支付日
    
    // 支付记录
    mapping(uint256 => PaymentStatus) public paymentHistory;
    uint256 public currentMonth;
    
    // 事件
    event ContractCreated(address indexed landlord, address indexed tenant);
    event ContractActivated();
    event RentPaid(uint256 month, uint256 amount);
    event ContractTerminated(string reason);
    event DepositClaimed(string reason);
    
    // 修改器
    modifier onlyLandlord() {
        require(msg.sender == landlord, "Only landlord can call");
        _;
    }
    
    modifier onlyTenant() {
        require(msg.sender == tenant, "Only tenant can call");
        _;
    }
    
    modifier onlyActive() {
        require(status == ContractStatus.Active, "Contract not active");
        _;
    }
    
    constructor(
        address _landlord,
        address _tenant,
        string memory _propertyAddress,
        uint256 _monthlyRent,
        uint256 _depositMonths,
        uint256 _startDate,
        uint256 _endDate,
        uint256 _paymentDay
    ) {
        landlord = _landlord;
        tenant = _tenant;
        propertyAddress = _propertyAddress;
        monthlyRent = _monthlyRent;
        deposit = _depositMonths;
        startDate = _startDate;
        endDate = _endDate;
        paymentDay = _paymentDay;
        
        depositAmount = monthlyRent * deposit;
        totalRent = monthlyRent * ((_endDate - _startDate) / 30 days);
        status = ContractStatus.Created;
        currentMonth = 0;
        
        emit ContractCreated(landlord, tenant);
    }
    
    // 签署合同
    function sign() external onlyTenant {
        require(msg.sender == tenant, "Only tenant can sign");
        status = ContractStatus.Active;
        paymentStatus = PaymentStatus.Pending;
        currentMonth = 1;
        emit ContractActivated();
    }
    
    // 支付租金
    function payRent() external payable onlyActive {
        require(msg.value >= monthlyRent, "Insufficient rent amount");
        paymentStatus = PaymentStatus.Paid;
        paymentHistory[currentMonth] = PaymentStatus.Paid;
        
        // 将租金转给房东
        payable(landlord).transfer(msg.value);
        
        emit RentPaid(currentMonth, msg.value);
        
        // 如果是最后一个月，标记为完成
        if (currentMonth >= (endDate - startDate) / 30 days) {
            status = ContractStatus.Completed;
            // 退还押金给租客
            payable(tenant).transfer(depositAmount);
        }
    }
    
    // 标记逾期
    function markLatePayment() external onlyLandlord onlyActive {
        paymentStatus = PaymentStatus.Late;
    }
    
    // 提前解约
    function terminateEarly(string memory reason) external onlyActive {
        require(msg.sender == landlord || msg.sender == tenant, "Unauthorized");
        
        // 计算违约金
        uint256 penalty = monthlyRent;
        
        if (msg.sender == landlord) {
            // 房东提前解约，退还押金 + 剩余租金
            payable(tenant).transfer(depositAmount + (monthlyRent * remainingMonths()));
        } else {
            // 租客提前解约，扣除违约金
            payable(landlord).transfer(depositAmount);
        }
        
        status = ContractStatus.Terminated;
        emit ContractTerminated(reason);
    }
    
    // 获取剩余月份
    function remainingMonths() public view returns (uint256) {
        return (endDate - startDate) / 30 days - currentMonth;
    }
    
    // 获取合同状态
    function getStatus() external view returns (
        ContractStatus _status,
        PaymentStatus _paymentStatus,
        uint256 _currentMonth,
        uint256 _remainingMonths
    ) {
        return (status, paymentStatus, currentMonth, remainingMonths());
    }
    
    // 模拟：获取余额
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
'''
        else:
            return '''// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MainContract
 * @dev 自定义智能合约 (Demo 模式)
 */
contract MainContract {
    string public description;
    address public owner;
    
    constructor(string memory _description) {
        description = _description;
        owner = msg.sender;
    }
    
    function getInfo() external view returns (string memory, address) {
        return (description, owner);
    }
}
'''
    
    def _generate_backend_code(self, requirement: ContractRequirement, tech_design: TechDesign) -> str:
        """生成后端代码"""
        return '''"""
AI Contract Platform - Backend Server
合约模拟后端服务
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
from simulator import ContractSimulator
from models import db, Contract, Payment
import json
from datetime import datetime

app = Flask(__name__)
CORS(app)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///contracts.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# 全局模拟器实例
simulator = ContractSimulator()

with app.app_context():
    db.create_all()


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "service": "contract-backend"})


@app.route('/api/contract/<project_id>/create', methods=['POST'])
def create_contract(project_id):
    """创建合约实例"""
    data = request.json
    
    result = simulator.create_contract(
        project_id=project_id,
        landlord=data.get('landlord'),
        tenant=data.get('tenant'),
        property_address=data.get('property'),
        monthly_rent=int(data.get('monthly_rent', 0)),
        deposit_months=int(data.get('deposit', 1)),
        start_date=data.get('start_date'),
        end_date=data.get('end_date'),
        payment_day=int(data.get('payment_day', 1))
    )
    
    return jsonify(result)


@app.route('/api/contract/<project_id>/sign', methods=['POST'])
def sign_contract(project_id):
    """签署合约"""
    result = simulator.sign(project_id)
    return jsonify(result)


@app.route('/api/contract/<project_id>/pay_rent', methods=['POST'])
def pay_rent(project_id):
    """支付租金"""
    data = request.json
    result = simulator.pay_rent(project_id, int(data.get('amount', 0)))
    return jsonify(result)


@app.route('/api/contract/<project_id>/status', methods=['GET'])
def get_status(project_id):
    """获取合约状态"""
    result = simulator.get_status(project_id)
    return jsonify(result)


@app.route('/api/contract/<project_id>/terminate', methods=['POST'])
def terminate_contract(project_id):
    """解约"""
    data = request.json
    result = simulator.terminate(project_id, data.get('reason', ''))
    return jsonify(result)


@app.route('/api/templates', methods=['GET'])
def get_templates():
    """获取可用模板"""
    return jsonify({
        "templates": [
            {"id": "housing_lease", "name": "住房租赁合同"},
            {"id": "employment", "name": "雇佣合同"},
            {"id": "goods_trade", "name": "商品交易合同"},
            {"id": "custom", "name": "自定义合同"}
        ]
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
'''
    
    def _generate_models(self, requirement: ContractRequirement) -> str:
        """生成数据模型"""
        return '''"""
数据模型
"""

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()


class Contract(db.Model):
    __tablename__ = 'contracts'
    
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.String(100), unique=True, nullable=False)
    template = db.Column(db.String(50))
    landlord = db.Column(db.String(100))
    tenant = db.Column(db.String(100))
    property_address = db.Column(db.String(200))
    monthly_rent = db.Column(db.Integer)
    deposit = db.Column(db.Integer)
    status = db.Column(db.String(20), default='created')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    payments = db.relationship('Payment', backref='contract', lazy=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'project_id': self.project_id,
            'template': self.template,
            'landlord': self.landlord,
            'tenant': self.tenant,
            'property_address': self.property_address,
            'monthly_rent': self.monthly_rent,
            'deposit': self.deposit,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Payment(db.Model):
    __tablename__ = 'payments'
    
    id = db.Column(db.Integer, primary_key=True)
    contract_id = db.Column(db.Integer, db.ForeignKey('contracts.id'), nullable=False)
    month = db.Column(db.Integer)
    amount = db.Column(db.Integer)
    status = db.Column(db.String(20), default='pending')
    paid_at = db.Column(db.DateTime)
    
    def to_dict(self):
        return {
            'id': self.id,
            'contract_id': self.contract_id,
            'month': self.month,
            'amount': self.amount,
            'status': self.status,
            'paid_at': self.paid_at.isoformat() if self.paid_at else None
        }
'''
    
    def _generate_simulator(self, requirement: ContractRequirement) -> str:
        """生成合约模拟器"""
        return '''"""
合约模拟器 - 在本地模拟智能合约的行为
"""

from typing import Dict, Any, Optional
from datetime import datetime, timedelta
import uuid


class ContractSimulator:
    """智能合约模拟器"""
    
    def __init__(self):
        self.contracts: Dict[str, Dict[str, Any]] = {}
    
    def create_contract(
        self,
        project_id: str,
        landlord: str,
        tenant: str,
        property_address: str,
        monthly_rent: int,
        deposit_months: int,
        start_date: str,
        end_date: str,
        payment_day: int
    ) -> Dict[str, Any]:
        """创建合约"""
        contract_id = str(uuid.uuid4())[:8]
        
        self.contracts[project_id] = {
            'id': contract_id,
            'project_id': project_id,
            'landlord': landlord,
            'tenant': tenant,
            'property_address': property_address,
            'monthly_rent': monthly_rent,
            'deposit': deposit_months * monthly_rent,
            'start_date': start_date,
            'end_date': end_date,
            'payment_day': payment_day,
            'status': 'Created',
            'current_month': 0,
            'total_paid': 0,
            'payments': []
        }
        
        return {
            'success': True,
            'contract_id': contract_id,
            'message': '合约已创建'
        }
    
    def sign(self, project_id: str) -> Dict[str, Any]:
        """签署合约"""
        if project_id not in self.contracts:
            return {'success': False, 'error': '合约不存在'}
        
        contract = self.contracts[project_id]
        
        if contract['status'] != 'Created':
            return {'success': False, 'error': f'合约状态不允许签署: {contract["status"]}'}
        
        contract['status'] = 'Active'
        contract['current_month'] = 1
        
        return {
            'success': True,
            'message': '合约签署成功',
            'status': 'Active'
        }
    
    def pay_rent(self, project_id: str, amount: int) -> Dict[str, Any]:
        """支付租金"""
        if project_id not in self.contracts:
            return {'success': False, 'error': '合约不存在'}
        
        contract = self.contracts[project_id]
        
        if contract['status'] != 'Active':
            return {'success': False, 'error': f'合约未激活: {contract["status"]}'}
        
        if amount < contract['monthly_rent']:
            return {'success': False, 'error': f'金额不足: 需要 {contract["monthly_rent"]}'}
        
        contract['total_paid'] += amount
        contract['payments'].append({
            'month': contract['current_month'],
            'amount': amount,
            'timestamp': datetime.now().isoformat()
        })
        
        return {
            'success': True,
            'message': f'租金支付成功: {amount}元',
            'current_month': contract['current_month'],
            'total_paid': contract['total_paid']
        }
    
    def get_status(self, project_id: str) -> Dict[str, Any]:
        """获取合约状态"""
        if project_id not in self.contracts:
            return {'success': False, 'error': '合约不存在'}
        
        return {
            'success': True,
            'contract': self.contracts[project_id]
        }
    
    def terminate(self, project_id: str, reason: str) -> Dict[str, Any]:
        """解约"""
        if project_id not in self.contracts:
            return {'success': False, 'error': '合约不存在'}
        
        contract = self.contracts[project_id]
        contract['status'] = 'Terminated'
        contract['termination_reason'] = reason
        
        return {
            'success': True,
            'message': f'合约已解约: {reason}'
        }
'''
    
    def _generate_backend_requirements(self) -> str:
        """生成后端依赖"""
        return '''flask>=2.3.0
flask-cors>=3.0.0
flask-sqlalchemy>=3.0.0
'''
    
    def _generate_frontend_project(self, requirement: ContractRequirement) -> Dict[str, str]:
        """生成前端项目文件"""
        
        if requirement.template == "housing_lease":
            return {
                "package.json": '''{
  "name": "housing-lease-demo",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "next": "^14.0.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.0.0"
  }
}''',
                "next.config.js": '''module.exports = {
  reactStrictMode: true,
  output: 'export',
  images: { unoptimized: true }
}''',
                "tsconfig.json": '''{
  "compilerOptions": {
    "target": "es5",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": false,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}''',
                "src/pages/index.tsx": self._generate_housing_lease_page()
            }
        else:
            return {
                "package.json": '{"name": "custom-demo", "version": "1.0.0"}',
                "src/pages/index.tsx": '''export default function CustomDemo() {
    return <div>自定义合约 Demo</div>
}'''
            }
    
    def _generate_housing_lease_page(self) -> str:
        """生成住房租赁合同页面"""
        return '''"use client";

import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface ContractState {
  status: string;
  landlord: string;
  tenant: string;
  monthlyRent: number;
  deposit: number;
  currentMonth: number;
  totalPaid: number;
}

export default function HousingLeaseDemo() {
  const [step, setStep] = useState(1);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [projectId] = useState(() => 'proj_' + Math.random().toString(36).substr(2, 9));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [formData, setFormData] = useState({
    landlord: '张三 (房东)',
    tenant: '李四 (租客)',
    property: '北京市朝阳区建国路88号',
    monthlyRent: 5000,
    deposit: 1,
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    paymentDay: 5,
  });

  // 步骤1：创建合约
  const createContract = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`/api/contract/${projectId}/create`, formData);
      if (res.data.success) {
        setMessage('合约创建成功！');
        setStep(2);
      }
    } catch (e) {
      // 模拟成功
      setContract({
        status: 'Created',
        landlord: formData.landlord,
        tenant: formData.tenant,
        monthlyRent: formData.monthlyRent,
        deposit: formData.deposit * formData.monthlyRent,
        currentMonth: 0,
        totalPaid: 0,
      });
      setMessage('合约创建成功（模拟模式）');
      setStep(2);
    }
    setLoading(false);
  };

  // 步骤2：签署合约
  const signContract = async () => {
    setLoading(true);
    // 模拟签署
    setContract(prev => prev ? {
      ...prev,
      status: 'Active',
      currentMonth: 1
    } : null);
    setMessage('合约签署成功！');
    setStep(3);
    setLoading(false);
  };

  // 步骤3：支付租金
  const payRent = async () => {
    setLoading(true);
    setContract(prev => prev ? {
      ...prev,
      totalPaid: prev.totalPaid + prev.monthlyRent
    } : null);
    setMessage(`第${contract?.currentMonth}月租金支付成功！`);
    setLoading(false);
  };

  // 步骤4：解约
  const terminate = async () => {
    setLoading(true);
    setContract(prev => prev ? {
      ...prev,
      status: 'Terminated'
    } : null);
    setMessage('合约已解约，押金已退还');
    setStep(5);
    setLoading(false);
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      padding: '40px'
    }}>
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <h1 style={{ color: '#fff', fontSize: '28px', marginBottom: '10px' }}>
            🏠 住房租赁合同 Demo
          </h1>
          <p style={{ color: '#888' }}>智能合约可视化演示</p>
        </div>

        {/* Progress Steps */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          marginBottom: '30px',
          position: 'relative'
        }}>
          {['创建', '签署', '支付', '解约'].map((s, i) => (
            <div key={i} style={{ 
              flex: 1, 
              textAlign: 'center',
              position: 'relative',
              zIndex: 1
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: step > i + 1 ? '#4ade80' : step === i + 1 ? '#3b82f6' : '#374151',
                color: '#fff',
                lineHeight: '40px',
                margin: '0 auto 8px',
                fontWeight: 'bold'
              }}>
                {step > i + 1 ? '✓' : i + 1}
              </div>
              <span style={{ color: step === i + 1 ? '#3b82f6' : '#888', fontSize: '14px' }}>
                {s}
              </span>
            </div>
          ))}
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50px',
            right: '50px',
            height: '2px',
            background: '#374151',
            zIndex: 0
          }}>
            <div style={{
              height: '100%',
              width: `${((step - 1) / 3) * 100}%`,
              background: '#4ade80',
              transition: 'width 0.3s'
            }} />
          </div>
        </div>

        {/* Contract Card */}
        <div style={{
          background: '#1e293b',
          borderRadius: '16px',
          padding: '30px',
          marginBottom: '20px',
          border: '1px solid #334155'
        }}>
          {/* Contract Info */}
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ color: '#fff', marginBottom: '15px' }}>📋 合约信息</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <InfoItem label="房东" value={formData.landlord} />
              <InfoItem label="租客" value={formData.tenant} />
              <InfoItem label="房屋地址" value={formData.property} />
              <InfoItem label="月租金" value={`${formData.monthlyRent} 元`} />
              <InfoItem label="押金" value={`${formData.deposit} 个月 (${formData.deposit * formData.monthlyRent} 元)`} />
              <InfoItem label="租期" value={`${formData.startDate} ~ ${formData.endDate}`} />
            </div>
          </div>

          {/* Status Panel */}
          {contract && (
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ color: '#fff', marginBottom: '15px' }}>📊 合约状态</h2>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(4, 1fr)', 
                gap: '12px' 
              }}>
                <StatusBox 
                  label="状态" 
                  value={contract.status}
                  color={contract.status === 'Active' ? '#4ade80' : contract.status === 'Terminated' ? '#f87171' : '#fbbf24'}
                />
                <StatusBox label="当前月份" value={`${contract.currentMonth} 月`} />
                <StatusBox label="已付租金" value={`${contract.totalPaid} 元`} />
                <StatusBox label="押金状态" value={contract.status === 'Terminated' ? '已退还' : '托管中'} />
              </div>
            </div>
          )}

          {/* Message */}
          {message && (
            <div style={{
              padding: '12px 16px',
              background: '#065f46',
              borderRadius: '8px',
              color: '#4ade80',
              marginBottom: '20px'
            }}>
              {message}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            {step === 1 && (
              <button 
                onClick={createContract}
                disabled={loading}
                style={buttonStyle('#3b82f6')}
              >
                {loading ? '创建中...' : '创建合约'}
              </button>
            )}
            {step === 2 && (
              <button 
                onClick={signContract}
                disabled={loading}
                style={buttonStyle('#3b82f6')}
              >
                {loading ? '签署中...' : '签署合约'}
              </button>
            )}
            {step === 3 && (
              <>
                <button 
                  onClick={payRent}
                  disabled={loading}
                  style={buttonStyle('#4ade80')}
                >
                  {loading ? '支付中...' : '💰 支付租金'}
                </button>
                <button 
                  onClick={() => setStep(4)}
                  style={buttonStyle('#f59e0b')}
                >
                  提前解约
                </button>
              </>
            )}
            {step === 4 && (
              <>
                <button 
                  onClick={terminate}
                  disabled={loading}
                  style={buttonStyle('#f87171')}
                >
                  {loading ? '处理中...' : '确认解约'}
                </button>
                <button 
                  onClick={() => setStep(3)}
                  style={buttonStyle('#6b7280')}
                >
                  返回
                </button>
              </>
            )}
            {step === 5 && (
              <div style={{ textAlign: 'center', width: '100%' }}>
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎉</div>
                <p style={{ color: '#4ade80', fontSize: '18px' }}>
                  合约生命周期演示完成！
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Operation Log */}
        <div style={{
          background: '#1e293b',
          borderRadius: '16px',
          padding: '20px',
          border: '1px solid #334155'
        }}>
          <h3 style={{ color: '#fff', marginBottom: '12px' }}>📝 操作日志</h3>
          <div style={{ 
            fontFamily: 'monospace', 
            fontSize: '13px',
            color: '#86efac',
            maxHeight: '120px',
            overflow: 'auto'
          }}>
            <p>{new Date().toLocaleString()} - 系统初始化</p>
            {message && <p>{new Date().toLocaleString()} - {message}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ 
      background: '#0f172a', 
      padding: '10px 12px', 
      borderRadius: '8px',
      border: '1px solid #334155'
    }}>
      <div style={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: '14px' }}>{value}</div>
    </div>
  );
}

function StatusBox({ label, value, color = '#fff' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ 
      background: '#0f172a', 
      padding: '12px', 
      borderRadius: '8px',
      textAlign: 'center',
      border: '1px solid #334155'
    }}>
      <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '4px' }}>{label}</div>
      <div style={{ color, fontSize: '16px', fontWeight: 'bold' }}>{value}</div>
    </div>
  );
}

const buttonStyle = (bg: string) => ({
  padding: '12px 32px',
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontSize: '16px',
  fontWeight: 'bold',
  cursor: 'pointer',
  transition: 'transform 0.1s, opacity 0.2s'
});
'''
    
    def run_full_pipeline(self, project_id: str, user_input: Dict) -> Dict:
        """运行完整流程"""
        results = {
            "project_id": project_id,
            "phases": {}
        }
        
        # 检查已完成阶段
        project_status = self.storage.get_project_status(project_id)
        steps = project_status.get("steps", {})
        
        # 阶段1：文档化（仅在未完成时执行）
        if steps.get("document", {}).get("status") != "completed":
            requirement = self.start_document_phase(project_id, user_input)
            results["phases"]["document"] = requirement
        else:
            requirement = self.storage.load_requirement(project_id)
            results["phases"]["document"] = "cached"
        
        # 阶段2：技术设计（仅在未完成时执行）
        if steps.get("tech_design", {}).get("status") != "completed":
            tech_design = self.start_tech_design_phase(project_id, requirement)
            results["phases"]["tech_design"] = tech_design
        else:
            tech_design = self.storage.load_tech_design(project_id)
            results["phases"]["tech_design"] = "cached"
        
        # 收集确认项
        confirmations = self.get_confirmation_requests(project_id)
        pending_confirmations = [c for c in confirmations if not c.selected]
        
        if pending_confirmations:
            results["confirmations"] = pending_confirmations
            return results  # 返回让用户确认
        
        # 阶段3：开发（仅在未完成时执行）
        if steps.get("development", {}).get("status") != "completed":
            self.start_development_phase(project_id)
        
        # 阶段4：UI 开发（仅在未完成时执行）
        if steps.get("ui_development", {}).get("status") != "completed":
            self.start_ui_development_phase(project_id)
        
        results["phases"]["development"] = "completed"
        results["phases"]["ui_development"] = "completed"
        
        # 阶段5：Demo
        demo = self.finalize_demo(project_id)
        results["demo"] = demo
        
        # 阶段6：更新项目整体状态为 completed
        self.storage.update_project_status(project_id, "completed")
        
        return results


# 全局实例
orchestrator = OrchestratorAgent()
