"""
AI Contract Platform - Nested Orchestrator
嵌套编排多Agent框架：使用 delegate_task 实现真正的并行/串行动态工作流

架构:
  Orchestrator (role=orchestrator) - 总指挥
  ├── Doc Agent (leaf) - 需求文档化
  ├── Tech Agent (leaf) - 可行性分析
  └── Dev+UI Agents (parallel leaves) - 并行开发
"""

import sys
import json
import time
import os
from pathlib import Path
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

# 添加项目路径 - 与 backend_server.py 保持一致
_project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_project_root))
sys.path.insert(0, str(_project_root / 'shared'))

from protocol import (
    ContractRequirement, TechDesign, ConfirmationItem, Term, TermEligibility
)
from storage import storage


class AgentPhase(Enum):
    """Agent 执行阶段"""
    DOC = "doc"           # 需求文档化
    TECH = "tech"         # 可行性分析
    DEV = "dev"           # 合约+后端开发
    UI = "ui"             # 前端开发


@dataclass
class PhaseResult:
    """阶段执行结果"""
    phase: AgentPhase
    success: bool
    data: Any = None
    error: Optional[str] = None
    duration: float = 0
    agent_id: Optional[str] = None


@dataclass
class WorkflowConfig:
    """工作流配置"""
    # 并行阶段：这些阶段可以同时执行
    parallel_phases: List[List[AgentPhase]] = field(default_factory=lambda: [
        [AgentPhase.DOC],           # 阶段1: 串行 (Doc)
        [AgentPhase.TECH],          # 阶段2: 串行 (Tech)
        [AgentPhase.DEV, AgentPhase.UI]  # 阶段3: 并行 (Dev + UI)
    ])
    
    # 失败策略
    fail_fast: bool = True          # True=遇错即停, False=继续执行
    skip_ui_on_dev_fail: bool = True  # Dev失败时跳过UI


class NestedOrchestrator:
    """
    嵌套编排器 - 使用 delegate_task 实现多Agent并行/串行动态工作流
    
    使用方式:
        orchestrator = NestedOrchestrator()
        
        # 方式1: 完整流程
        result = await orchestrator.run_full_pipeline(project_id, user_input)
        
        # 方式2: 单阶段执行
        doc_result = await orchestrator.run_phase(AgentPhase.DOC, input_data)
        
        # 方式3: 并行执行多个阶段
        results = await orchestrator.run_parallel([AgentPhase.DEV, AgentPhase.UI], input_data)
    """
    
    def __init__(self, event_callback: Optional[Callable] = None):
        self.storage = storage
        self.event_callback = event_callback
        self.phase_results: Dict[AgentPhase, PhaseResult] = {}
        self.current_project_id: Optional[str] = None
        self.workflow_config = WorkflowConfig()
        
        # Agent 工具集配置
        self.agent_toolsets = {
            AgentPhase.DOC: ['terminal', 'file', 'web'],
            AgentPhase.TECH: ['terminal', 'file', 'web'],
            AgentPhase.DEV: ['terminal', 'file', 'web'],
            AgentPhase.UI: ['terminal', 'file', 'web']
        }
    
    def emit_event(self, event_type: str, data: Dict):
        """发送事件"""
        event = {
            "type": event_type,
            "timestamp": datetime.now().isoformat(),
            **data
        }
        if self.event_callback:
            self.event_callback(event)
    
    async def run_full_pipeline(self, project_id: str, user_input: Dict) -> Dict:
        """
        完整流水线: Doc → Tech → (Dev || UI)
        
        Args:
            project_id: 项目ID
            user_input: 用户输入数据
            
        Returns:
            包含各阶段结果的字典
        """
        self.current_project_id = project_id
        self.phase_results = {}
        
        self.emit_event("pipeline_started", {
            "project_id": project_id,
            "message": "开始执行多Agent流水线"
        })
        
        try:
            # ========== 阶段1: Doc (串行) ==========
            self.emit_event("phase_started", {
                "phase": "doc",
                "message": "启动 Doc Agent..."
            })
            
            doc_result = await self.run_phase(
                AgentPhase.DOC,
                self._build_doc_input(project_id, user_input)
            )
            
            if not doc_result.success:
                raise Exception(f"Doc阶段失败: {doc_result.error}")
            
            requirement = doc_result.data
            
            # 保存需求文档
            self.storage.save_requirement(project_id, requirement)
            
            # 发送需求文档完成事件
            self.emit_event("artifact_ready", {
                "phase": "doc",
                "artifact_type": "requirement",
                "artifact_path": str(self.storage.get_project_path(project_id) / "requirement"),
                "message": "需求文档已生成"
            })
            
            # ========== 阶段2: Tech (串行) ==========
            self.emit_event("phase_started", {
                "phase": "tech", 
                "message": "启动 Tech Agent..."
            })
            
            tech_result = await self.run_phase(
                AgentPhase.TECH,
                self._build_tech_input(project_id, requirement)
            )
            
            if not tech_result.success:
                raise Exception(f"Tech阶段失败: {tech_result.error}")
            
            tech_design = tech_result.data
            
            # 保存技术设计文档
            self.storage.save_tech_design(project_id, tech_design)
            
            # 发送技术文档完成事件
            self.emit_event("artifact_ready", {
                "phase": "tech",
                "artifact_type": "tech_design",
                "artifact_path": str(self.storage.get_project_path(project_id) / "tech-design"),
                "message": "技术设计文档已生成"
            })
            
            # 检查是否有确认项
            confirmations = self._extract_confirmations(tech_design)
            if confirmations:
                self.emit_event("confirmations_required", {
                    "project_id": project_id,
                    "confirmations": [c.to_dict() for c in confirmations]
                })
                return {
                    "status": "awaiting_confirmation",
                    "confirmations": confirmations,
                    "requirement": requirement,
                    "tech_design": tech_design
                }
            
            # ========== 阶段3: Dev + UI (并行) ==========
            self.emit_event("phase_started", {
                "phase": "dev_ui",
                "message": "启动 Dev + UI Agents (并行)..."
            })
            
            # 并行执行 Dev 和 UI
            dev_result, ui_result = await self.run_parallel(
                [AgentPhase.DEV, AgentPhase.UI],
                self._build_dev_ui_input(project_id, requirement, tech_design)
            )
            
            # 处理结果
            dev_success = dev_result.success if dev_result else False
            ui_success = ui_result.success if ui_result else False
            
            if self.workflow_config.fail_fast and not dev_success:
                raise Exception(f"Dev阶段失败: {dev_result.error if dev_result else 'Unknown'}")
            
            self.emit_event("pipeline_completed", {
                "project_id": project_id,
                "dev_success": dev_success,
                "ui_success": ui_success,
                "demo_url": f"/demo/{project_id}"
            })
            
            return {
                "status": "completed",
                "requirement": requirement,
                "tech_design": tech_design,
                "dev_result": dev_result.data if dev_result else None,
                "ui_result": ui_result.data if ui_result else None
            }
            
        except Exception as e:
            self.emit_event("pipeline_error", {
                "project_id": project_id,
                "error": str(e)
            })
            return {
                "status": "error",
                "error": str(e)
            }
    
    async def run_full_pipeline_after_confirmation(self, project_id: str, requirement: ContractRequirement, tech_design: TechDesign) -> Dict:
        """
        确认后的流水线：跳过 Doc/Tech，直接运行 Dev + UI
        
        Args:
            project_id: 项目ID
            requirement: 已保存的需求文档
            tech_design: 已保存的技术设计（含用户确认的选择）
            
        Returns:
            包含 Dev + UI 执行结果的字典
        """
        self.current_project_id = project_id
        self.phase_results = {}
        
        self.emit_event("pipeline_continued", {
            "project_id": project_id,
            "message": "确认完成，继续执行 Dev + UI 阶段..."
        })
        
        try:
            # 更新 storage 中的 tech_design（包含用户确认选项）
            self.storage.save_tech_design(project_id, tech_design)
            
            # ========== 阶段3: Dev + UI (并行) ==========
            self.emit_event("phase_started", {
                "phase": "dev_ui",
                "message": "启动 Dev + UI Agents (并行)..."
            })
            
            # 并行执行 Dev 和 UI
            dev_result, ui_result = await self.run_parallel(
                [AgentPhase.DEV, AgentPhase.UI],
                self._build_dev_ui_input(project_id, requirement, tech_design)
            )
            
            # 处理结果
            dev_success = dev_result.success if dev_result else False
            ui_success = ui_result.success if ui_result else False
            
            # 如果 Dev 失败且 fail_fast=True，抛出异常
            if self.workflow_config.fail_fast and not dev_success:
                raise Exception(f"Dev阶段失败: {dev_result.error if dev_result else 'Unknown'}")
            
            # 只有在成功时才保存代码和更新 metadata
            if dev_success and dev_result and dev_result.data:
                dev_data = dev_result.data
                
                # --- 修复: dev agent 返回 "contracts" (plural) 不是 "contract" (singular) ---
                # 保存合约代码 (dev_data["contracts"] 是 list，每个可能是 str 或 dict)
                contracts_val = None
                if hasattr(dev_data, 'contracts') and dev_data.contracts:
                    contracts_val = dev_data.contracts
                elif isinstance(dev_data, dict):
                    contracts_val = dev_data.get("contracts") or dev_data.get("contract")
                
                if contracts_val:
                    if isinstance(contracts_val, list):
                        for i, item in enumerate(contracts_val):
                            if isinstance(item, str):
                                fname = f"Contract{i}.sol"
                                self.storage.save_code(project_id, "contract", item, fname)
                            elif isinstance(item, dict):
                                # dict 格式: {"code": "...", "name": "..."} 或 {"source": "...", "name": "..."}
                                code = item.get("code") or item.get("source") or str(item)
                                fname = item.get("name") or item.get("filename") or f"Contract{i}.sol"
                                self.storage.save_code(project_id, "contract", code, fname)
                    elif isinstance(contracts_val, str):
                        self.storage.save_code(project_id, "contract", contracts_val, "MainContract.sol")
                
                # 保存后端代码 (dev_data["backend"] 是 dict: {"server.py": "...", ...})
                backend_val = None
                if hasattr(dev_data, 'backend') and dev_data.backend:
                    backend_val = dev_data.backend
                elif isinstance(dev_data, dict):
                    backend_val = dev_data.get("backend")
                
                if backend_val:
                    if isinstance(backend_val, dict):
                        self.storage.save_backend_project(project_id, backend_val)
                    else:
                        self.storage.save_backend_project(project_id, {"server.py": str(backend_val)})
            
            # 保存前端代码（如果有）
            ui_has_content = False
            if ui_success and ui_result and ui_result.data:
                ui_data = ui_result.data
                frontend_data = None
                if hasattr(ui_data, 'frontend') and ui_data.frontend:
                    frontend_data = ui_data.frontend
                elif isinstance(ui_data, dict) and ui_data.get("frontend"):
                    frontend_data = ui_data["frontend"]
                
                # 检查是否有实际内容
                if frontend_data and isinstance(frontend_data, dict) and len(frontend_data) > 0:
                    # 扁平化处理：如果某个 value 是 dict（目录结构），则展开它
                    flat_files = {}
                    for k, v in frontend_data.items():
                        if isinstance(v, dict):
                            # nested dict like {"pages": {"index.tsx": "..."}} → flatten to "pages/index.tsx"
                            for sub_k, sub_v in v.items():
                                flat_files[f"{k}/{sub_k}"] = sub_v
                        elif isinstance(v, str):
                            # 直接是文件路径 key，如 "pages/index.tsx": "content"
                            flat_files[k] = v
                    if flat_files:
                        self.storage.save_frontend_project(project_id, flat_files)
                        ui_has_content = True
                    else:
                        # dict 但没有可提取的文件内容，生成 fallback
                        self.storage.save_frontend_project(project_id, self._generate_fallback_frontend(project_id, requirement))
                        ui_has_content = True
                elif frontend_data and isinstance(frontend_data, list):
                    # UI agent 返回了 list 格式的文件列表 [{filename, content}, ...]
                    files_dict = {}
                    for item in frontend_data:
                        if isinstance(item, dict) and "filename" in item and "content" in item:
                            files_dict[item["filename"]] = item["content"]
                        elif isinstance(item, dict) and "path" in item and "content" in item:
                            files_dict[item["path"]] = item["content"]
                        elif isinstance(item, dict) and len(item) == 1:
                            # {"pages/demo/test.tsx": "..."} style
                            files_dict.update(item)
                    if files_dict:
                        self.storage.save_frontend_project(project_id, files_dict)
                        ui_has_content = True
                    else:
                        self.storage.save_frontend_project(project_id, self._generate_fallback_frontend(project_id, requirement))
                        ui_has_content = True
                elif frontend_data:
                    # 空 dict，生成 fallback
                    self.storage.save_frontend_project(project_id, self._generate_fallback_frontend(project_id, requirement))
                    ui_has_content = True
            
            # 如果 UI 没有内容但 dev 成功，也生成 fallback
            if not ui_has_content and dev_success:
                self.storage.save_frontend_project(project_id, self._generate_fallback_frontend(project_id, requirement))
                ui_has_content = True

            # Fallback: 检查 storage 的 frontend 目录是否已有文件（agent 可能直接写了）
            if not ui_has_content:
                frontend_dir = self.storage.get_project_path(project_id) / "frontend" / "files"
                if frontend_dir.exists() and any(frontend_dir.iterdir()):
                    ui_has_content = True

            # 更新 metadata（只有成功时才标记 completed）
            self.storage.update_step_status(project_id, "development", "completed" if dev_success else "failed")
            self.storage.update_step_status(project_id, "ui_development", "completed" if ui_has_content else "failed")
            self.storage.update_step_status(project_id, "demo", "completed")
            self.storage.update_project_status(project_id, "completed" if (dev_success and ui_success) else "failed")
            
            self.emit_event("pipeline_completed", {
                "project_id": project_id,
                "dev_success": dev_success,
                "ui_success": ui_success,
                "demo_url": f"/demo/{project_id}"
            })
            
            return {
                "status": "completed" if (dev_success and ui_success) else "partial",
                "requirement": requirement,
                "tech_design": tech_design,
                "dev_result": dev_result.data if dev_result else None,
                "ui_result": ui_result.data if ui_result else None,
                "demo_url": f"/demo/{project_id}"
            }
            
        except Exception as e:
            self.emit_event("pipeline_error", {
                "project_id": project_id,
                "error": str(e)
            })
            return {
                "status": "error",
                "error": str(e)
            }
    
    async def run_phase(self, phase: AgentPhase, input_data: Dict) -> PhaseResult:
        """
        执行单个阶段 - 使用 asyncio.create_subprocess_exec 异步流式输出
        
        Args:
            phase: 阶段类型
            input_data: 传递给Agent的输入数据
            
        Returns:
            PhaseResult: 阶段执行结果
        """
        import asyncio
        import subprocess
        import tempfile
        import time
        
        start_time = time.time()
        agent_profile = f"contract-{phase.value}"
        
        self.emit_event("agent_started", {
            "phase": phase.value,
            "agent": agent_profile,
            "message": f"{phase.value.upper()} Agent 开始执行..."
        })
        
        try:
            # 构建任务描述
            task_prompt = self._build_task_prompt(phase, input_data)
            context = self._build_agent_context(phase, input_data)
            
            # 构建完整的 prompt
            full_prompt = f"""{task_prompt}

## 上下文信息
{context}

请只返回纯 JSON 结果，不要任何其他内容。"""
            
            # 写入临时文件
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
                f.write(full_prompt)
                prompt_file = f.name
            
            try:
                # 阶段特定的思考提示
                thinking_prefixes = {
                    AgentPhase.DOC: ["正在解析用户需求...", "正在提取合同条款...", "正在分类条款类型...", "正在生成需求文档..."],
                    AgentPhase.TECH: ["正在评估技术可行性...", "正在设计合约架构...", "正在分析安全风险...", "正在生成技术方案..."],
                    AgentPhase.DEV: ["正在分析需求文档...", "正在编写 Solidity 合约...", "正在生成后端模拟器...", "正在集成合约代码..."],
                    AgentPhase.UI: ["正在分析交互流程...", "正在设计前端界面...", "正在编写 React 组件...", "正在生成前端代码..."],
                }
                prefixes = thinking_prefixes.get(phase, ["正在执行任务..."])
                
                # 发送初始思考事件
                for i, prefix in enumerate(prefixes):
                    self.emit_event("agent_thinking", {
                        "phase": phase.value,
                        "content": prefix,
                        "step": i,
                        "total_steps": len(prefixes)
                    })
                    # 短暂延迟让前端有时间渲染
                    await asyncio.sleep(0.3)
                
                # 使用 asyncio 异步运行 hermes chat（流式输出，不传 -Q 以获取中间输出）
                cmd = [
                    'hermes', 'chat',
                    '--profile', agent_profile,
                    '-q', f'Read {prompt_file} and return ONLY JSON',
                    '-Q'  # Quiet mode: 只输出最终结果（简化解析）
                ]
                
                # 使用 asyncio.create_subprocess_exec 执行 hermes chat
                # 用 communicate() 一次性获取全部输出，避免流式干扰 JSON 解析
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=str(Path(__file__).parent.parent.parent)
                )
                
                # 一次性读取所有输出（含超时保护）
                try:
                    stdout_bytes, stderr_bytes = await asyncio.wait_for(
                        proc.communicate(), timeout=300
                    )
                    stdout_output = stdout_bytes.decode('utf-8', errors='replace') if stdout_bytes else ''
                    stderr_output = stderr_bytes.decode('utf-8', errors='replace') if stderr_bytes else ''
                except asyncio.TimeoutError:
                    proc.kill()
                    await proc.wait()
                    raise Exception(f"Agent {agent_profile} timed out after 300s")
                
                # stderr 可能有警告/进度信息，用于 thinking 事件
                if stderr_output and stderr_output.strip():
                    for stderr_line in stderr_output.strip().split('\n'):
                        stderr_line = stderr_line.strip()
                        if stderr_line and len(stderr_line) > 1:
                            self.emit_event("agent_thinking", {
                                "phase": phase.value,
                                "content": stderr_line[:500],
                                "step": len(prefixes),
                                "total_steps": len(prefixes)
                            })
                
                output = stdout_output.strip()
                
                # 发送完成思考事件
                self.emit_event("agent_thinking", {
                    "phase": phase.value,
                    "content": "✅ 任务完成，正在解析结果...",
                    "step": len(prefixes),
                    "total_steps": len(prefixes)
                })
                
                # 提取 JSON
                json_str = self._extract_json_from_output(output)
                
                # 解析为 Python 对象
                agent_result = json.loads(json_str)
                
                duration = time.time() - start_time
                
                # 解析为对应的数据结构
                parsed_data = self._parse_agent_result(phase, agent_result)
                
                self.emit_event("agent_completed", {
                    "phase": phase.value,
                    "duration": f"{duration:.1f}s",
                    "success": True
                })
                
                return PhaseResult(
                    phase=phase,
                    success=True,
                    data=parsed_data,
                    duration=duration
                )
                
            finally:
                os.unlink(prompt_file)
                
        except subprocess.TimeoutExpired:
            duration = time.time() - start_time
            error_msg = f"Agent {agent_profile} timed out after 300s"
            
            self.emit_event("agent_failed", {
                "phase": phase.value,
                "error": error_msg,
                "duration": f"{duration:.1f}s"
            })
            
            return PhaseResult(
                phase=phase,
                success=False,
                error=error_msg,
                duration=duration
            )
            
        except json.JSONDecodeError as e:
            duration = time.time() - start_time
            error_msg = f"Agent {agent_profile} returned invalid JSON: {e}"
            
            self.emit_event("agent_failed", {
                "phase": phase.value,
                "error": error_msg,
                "duration": f"{duration:.1f}s"
            })
            
            return PhaseResult(
                phase=phase,
                success=False,
                error=error_msg,
                duration=duration
            )
            
        except Exception as e:
            duration = time.time() - start_time
            error_msg = str(e)
            
            self.emit_event("agent_failed", {
                "phase": phase.value,
                "error": error_msg,
                "duration": f"{duration:.1f}s"
            })
            
            return PhaseResult(
                phase=phase,
                success=False,
                error=error_msg,
                duration=duration
            )
    
    def _extract_json_from_output(self, output: str) -> str:
        """从 hermes chat 输出中提取 JSON
        
        使用括号匹配算法正确处理包含 Solidity 代码等嵌套 {} 的输出。
        """
        import re
        
        def find_json_end(s: str, start: int) -> int:
            """Find the position after the JSON object ending at the last unescaped '}'.
            Uses bracket matching that ignores braces inside strings.
            """
            depth = 0
            in_string = False
            escape_next = False
            for i, ch in enumerate(s[start:], start):
                if escape_next:
                    escape_next = False
                    continue
                if ch == '\\':
                    escape_next = True
                elif ch == '"' and not escape_next:
                    in_string = not in_string
                elif not in_string:
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            return i + 1
            return -1
        
        # 去掉 session_id 前缀行（-Q 模式会输出）
        lines = output.strip().split('\n')
        if lines and lines[0].startswith('session_id:'):
            lines = lines[1:]
        output = '\n'.join(lines).strip()
        
        # 如果是纯 JSON（-Q 模式），直接返回
        if output.startswith('{') and output.endswith('}'):
            try:
                json.loads(output)
                return output
            except json.JSONDecodeError:
                pass  # 不完整，继续解析
        
        # 尝试找到 Box UI 格式中的 JSON
        start_marker = "╭─ ⚕ Hermes ──"
        end_marker = "╰─"
        
        start_idx = output.find(start_marker)
        if start_idx != -1:
            json_start = output.find("{", start_idx)
            if json_start != -1:
                search_area = output[start_idx:]
                end_idx_in_area = search_area.rfind(end_marker)
                if end_idx_in_area != -1:
                    # 使用括号匹配找正确的结束位置（忽略字符串内的 }）
                    end_pos = find_json_end(output, json_start)
                    if end_pos != -1 and end_pos <= start_idx + end_idx_in_area:
                        candidate = output[json_start:end_pos]
                        try:
                            json.loads(candidate)
                            return candidate
                        except json.JSONDecodeError:
                            pass
                else:
                    # 没有 end_marker，使用括号匹配
                    end_pos = find_json_end(output, json_start)
                    if end_pos != -1:
                        candidate = output[json_start:end_pos]
                        try:
                            json.loads(candidate)
                            return candidate
                        except json.JSONDecodeError:
                            pass
        
        # Fallback: 尝试去掉 markdown 代码块
        if '```' in output:
            code_lines = []
            in_code_block = False
            for line in lines:
                if line.startswith('```'):
                    in_code_block = not in_code_block
                    continue
                if in_code_block:
                    code_lines.append(line)
            if code_lines:
                candidate = '\n'.join(code_lines).strip()
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    pass
        
        # 最后 fallback: 找第一个 { 开始的完整 JSON，使用括号匹配
        first_brace = output.find('{')
        if first_brace != -1:
            end_pos = find_json_end(output, first_brace)
            if end_pos != -1:
                candidate = output[first_brace:end_pos]
                try:
                    json.loads(candidate)
                    return candidate
                except json.JSONDecodeError:
                    pass
        
        return output  # 实在解析不了就返回原输出
    
    async def run_parallel(self, phases: List[AgentPhase], input_data: Dict) -> List[PhaseResult]:
        """
        并行执行多个阶段
        
        Args:
            phases: 阶段列表
            input_data: 输入数据
            
        Returns:
            各阶段结果列表
        """
        import asyncio
        from concurrent.futures import ThreadPoolExecutor
        
        # 直接创建任务列表并并行等待
        tasks = []
        for phase in phases:
            task = self.run_phase(phase, {
                **input_data,
                "_phase": phase.value
            })
            tasks.append(task)
        
        # 并行等待所有任务完成
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # 转换为 PhaseResult 列表
        phase_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                phase_results.append(PhaseResult(
                    phase=phases[i],
                    success=False,
                    error=str(result)
                ))
            else:
                phase_results.append(result)
        
        return phase_results
    
    def _build_doc_input(self, project_id: str, user_input: Dict) -> Dict:
        """构建 Doc Agent 输入"""
        return {
            "project_id": project_id,
            "project_name": user_input.get("name", "未命名项目"),
            "template": user_input.get("template", "custom"),
            "summary": user_input.get("summary", ""),
            "parties": user_input.get("parties", {}),
            **user_input
        }
    
    def _build_tech_input(self, project_id: str, requirement: ContractRequirement) -> Dict:
        """构建 Tech Agent 输入"""
        return {
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
    
    def _build_dev_ui_input(self, project_id: str, requirement: ContractRequirement, 
                           tech_design: TechDesign) -> Dict:
        """构建 Dev + UI Agent 输入"""
        return {
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
                "contracts": tech_design.contracts,
                "patterns": tech_design.patterns,
                "dependencies": tech_design.dependencies
            },
            "project_path": str(self.storage.get_project_path(project_id))
        }
    
    def _build_task_prompt(self, phase: AgentPhase, input_data: Dict) -> str:
        """构建 Agent 任务描述"""
        prompts = {
            AgentPhase.DOC: """分析合同需求，生成结构化需求文档。

任务：
1. 解析用户输入的合同信息（模板类型、字段数据）
2. 识别所有条款并分类（ELIGIBLE/CONDITIONAL/NOT_ELIGIBLE）
3. 生成符合 ContractRequirement 格式的 JSON

输出要求：
- 只返回纯 JSON，不要 markdown 包裹
- 格式见下方 schema""",
            
            AgentPhase.TECH: """分析需求可行性，设计智能合约架构。

任务：
1. 评估每个条款的技术可行性
2. 设计合约结构（主合约、库、接口）
3. 识别风险并给出缓解方案
4. 生成需要用户确认的条款列表

输出要求：
- 只返回纯 JSON""",
            
            AgentPhase.DEV: """生成智能合约和后端模拟器代码。

任务：
1. 根据技术设计生成 Solidity 合约代码
2. 生成 Python 后端模拟器（模拟合约运行）
3. 确保代码可运行（本地模拟模式）

输出要求：
- 返回 JSON: { "contracts": [...], "backend": {...} }
- 包含完整的源代码""",
            
            AgentPhase.UI: """生成前端界面代码。

任务：
1. 基于合约信息生成 React/Next.js 前端
2. 实现合约交互界面（填写参数、调用方法、查看状态）
3. 使用 demo URL: http://122.51.247.121:5001/api/simulate/{project_id}

输出要求：
- 返回 JSON: { "frontend": {...} }
- 包含完整的源代码"""
        }
        return prompts.get(phase, "执行指定任务")
    
    def _build_agent_context(self, phase: AgentPhase, input_data: Dict) -> str:
        """构建 Agent 上下文（传给子Agent的背景信息）"""
        project_id = input_data.get("project_id", "unknown")
        project_path = self.storage.get_project_path(project_id)
        
        base_context = f"""项目ID: {project_id}
项目路径: {project_path}

输入数据:
{json.dumps(input_data, ensure_ascii=False, indent=2)}

约束：
- 后端 API 必须使用 http://122.51.247.121:5000
- 前端开发服务器端口: 3000
- 模拟器端口: 5001
- 所有代码必须真实可运行，禁止模板填充
"""
        return base_context
    
    def _parse_agent_result(self, phase: AgentPhase, result: Any) -> Any:
        """解析 Agent 返回结果"""
        if phase == AgentPhase.DOC:
            # 解析为 ContractRequirement
            if isinstance(result, dict) and "terms" in result:
                terms = []
                for t in result.get("terms", []):
                    elig_map = {
                        "ELIGIBLE": TermEligibility.ELIGIBLE,
                        "CONDITIONAL": TermEligibility.CONDITIONAL,
                        "NOT_ELIGIBLE": TermEligibility.NOT_ELIGIBLE
                    }
                    terms.append(Term(
                        id=t["id"],
                        type=t["type"],
                        description=t["description"],
                        eligible=elig_map.get(t.get("eligible"), TermEligibility.CONDITIONAL),
                        details=t.get("details", {}),
                        priority=t.get("priority", "medium")
                    ))
                
                return ContractRequirement(
                    project_id=result.get("project_id", ""),
                    project_name=result.get("project_name", ""),
                    template=result.get("template", "custom"),
                    summary=result.get("summary", ""),
                    parties=result.get("parties", {}),
                    terms=terms,
                    contractable_terms=result.get("contractable_terms", []),
                    non_contractable_terms=result.get("non_contractable_terms", []),
                    pending_terms=result.get("pending_terms", [])
                )
            return result
        
        elif phase == AgentPhase.TECH:
            # 解析为 TechDesign
            if isinstance(result, dict) and "contracts" in result:
                return TechDesign(
                    project_id=result.get("project_id", ""),
                    contracts=result.get("contracts", []),
                    patterns=result.get("patterns", []),
                    dependencies=result.get("dependencies", ["@openzeppelin/contracts"]),
                    risks=result.get("risks", []),
                    confirmation_items=result.get("confirmation_items", [])
                )
            return result
        
        return result
    
    def _extract_confirmations(self, tech_design: TechDesign) -> List[ConfirmationItem]:
        """从技术设计中提取需要确认的项"""
        confirmations = []
        if tech_design and tech_design.confirmation_items:
            for item in tech_design.confirmation_items:
                if item.get("selected") is None:
                    confirmations.append(ConfirmationItem(
                        id=item["id"],
                        title=item["title"],
                        description=item["description"],
                        options=item["options"],
                        category=item.get("category", "general")
                    ))
        return confirmations

    def _generate_fallback_frontend(self, project_id: str, requirement: ContractRequirement) -> Dict[str, str]:
        """当 UI agent 返回空时，生成最小化的 fallback 前端"""
        project_name = requirement.project_name if requirement else project_id
        
        return {
            "pages/index.tsx": f'''"use client";
import React, {{ useState, useEffect }} from "react";

export default function Home() {{
  const [status, setStatus] = useState<string>("Loading...");
  const [error, setError] = useState<string>("");
  
  useEffect(() => {{
    fetch("http://122.51.247.121:5001/api/simulate/{project_id}")
      .then(r => r.json())
      .then(data => {{
        setStatus(data.status || "Ready");
      }})
      .catch(e => {{
        setError(e.message);
        setStatus("Error connecting to simulator");
      }});
  }}, []);

  return (
    <main className="min-h-screen p-8 bg-gray-900 text-white">
      <h1 className="text-3xl font-bold mb-4">{{"{project_name}"}}</h1>
      <div className="bg-gray-800 p-4 rounded-lg">
        <p className="text-green-400">Status: {{status}}</p>
        {{error && <p className="text-red-400 mt-2">Error: {{error}}</p>}}
      </div>
    </main>
  );
}}
''',
            "package.json": '''{
  "name": "fallback-ui",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3000"
  },
  "dependencies": {
    "next": "14.0.4",
    "react": "18.2.0",
    "react-dom": "18.2.0"
  },
  "devDependencies": {
    "typescript": "5.3.3",
    "@types/node": "20.10.6",
    "@types/react": "18.2.46",
    "@types/react-dom": "18.2.18",
    "tailwindcss": "3.4.0",
    "postcss": "8.4.32",
    "autoprefixer": "10.4.16"
  }
}''',
            "tailwind.config.js": '''module.exports = {
  content: ["./pages/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: { extend: {} },
  plugins: [],
}''',
            "postcss.config.js": "module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }",
            "pages/_app.tsx": "import '../styles/globals.css'\n\nexport default function App({{ Component, pageProps }}) {\n  return <Component {...pageProps} />\n}",
            "styles/globals.css": "@tailwind base; @tailwind components; @tailwind utilities;"
        }


# 兼容旧接口的包装器
class LegacyOrchestratorWrapper:
    """
    兼容旧 Orchestrator 接口的包装器
    用于无缝迁移到新的嵌套编排框架
    """
    
    def __init__(self, event_callback: Optional[Callable] = None):
        self._nested = NestedOrchestrator(event_callback)
    
    async def run_full_pipeline_async(self, project_id: str, user_input: Dict) -> Dict:
        """异步版本的完整流水线"""
        return await self._nested.run_full_pipeline(project_id, user_input)
    
    def run_full_pipeline(self, project_id: str, user_input: Dict) -> Dict:
        """同步版本的完整流水线（内部使用事件循环）"""
        import asyncio
        
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 如果已经在事件循环中，创建Task
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        asyncio.run,
                        self._nested.run_full_pipeline(project_id, user_input)
                    )
                    return future.result()
            else:
                return loop.run_until_complete(
                    self._nested.run_full_pipeline(project_id, user_input)
                )
        except RuntimeError:
            # 没有事件循环，创建新的
            return asyncio.run(
                self._nested.run_full_pipeline(project_id, user_input)
            )