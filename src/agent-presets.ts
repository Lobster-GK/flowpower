/**
 * 子 agent 使用的模型类型。
 *
 * text 适合代码、计划、验证、审查等文本任务；multimodal 适合截图和 UI 图片观察。
 */
export type AgentModelKind = "multimodal" | "text";

/**
 * 插件默认 subagent 的静态预设。
 */
export interface AgentPreset {
  name: string;
  description: string;
  promptFile: string;
  tools: Record<string, boolean>;
  modelKind: AgentModelKind;
}

/**
 * 内置 AFP subagent 列表。
 */
export const AGENT_PRESETS: AgentPreset[] = [
  {
    name: "afp-context-agent",
    description: "上下文侦察 agent：读取相关代码、项目资产、目录结构和已有实现模式，返回当前任务所需事实；只读，不规划、不改代码。",
    promptFile: "afp-context-agent.md",
    modelKind: "text",
    tools: {
      read: true,
      write: false,
      edit: false,
      bash: true,
    },
  },
  {
    name: "afp-observer-agent",
    description: "独立识别 agent：根据全部图片、页面状态、文字描述或已有实现，输出可单独验收的完整事实结果、相对位置、状态差异、关键特征和开放问题。",
    promptFile: "afp-observer-agent.md",
    modelKind: "multimodal",
    tools: {
      read: true,
      write: true,
      edit: false,
      bash: false,
    },
  },
  {
    name: "afp-planner-agent",
    description: "方案计划 agent：基于需求、上下文、观察结果、错误证据或接口资料生成和审查可执行计划；不写业务代码。",
    promptFile: "afp-planner-agent.md",
    modelKind: "text",
    tools: {
      read: true,
      write: true,
      edit: false,
      bash: false,
    },
  },
  {
    name: "afp-builder-agent",
    description: "实现 agent：在计划、上下文和边界明确后执行代码生成、局部改造、错误修复、接口接入或文档更新；按范围实施，不自行扩大需求。",
    promptFile: "afp-builder-agent.md",
    modelKind: "text",
    tools: {
      read: true,
      write: true,
      edit: true,
      bash: true,
    },
  },
  {
    name: "afp-verifier-agent",
    description: "证据验证 agent：按委派要求执行检查、命令、启动、浏览器访问、日志分析或结果核对，返回结构化证据；不直接改代码。",
    promptFile: "afp-verifier-agent.md",
    modelKind: "text",
    tools: {
      read: true,
      write: true,
      edit: false,
      bash: true,
    },
  },
  {
    name: "afp-review-agent",
    description: "独立审查 agent：审查需求、观察结果、计划、代码改动、验证结果、文档或流程风险，指出遗漏和建议；只审查，不实施。",
    promptFile: "afp-review-agent.md",
    modelKind: "text",
    tools: {
      read: true,
      write: false,
      edit: false,
      bash: true,
    },
  },
];
