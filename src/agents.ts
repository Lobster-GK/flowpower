import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENT_PRESETS, type AgentPreset } from "./agent-presets.js";
import { packageRoot } from "./config.js";
import { getProjectSubagentModels } from "./project-config.js";

type MutableConfig = Record<string, unknown>;

/**
 * config.yaml 中解析出的 subagent 模型映射。
 */
type SubagentModelConfig = Record<string, string>;

/**
 * 从插件包读取内置 subagent prompt。
 *
 * 如果包内容缺失，返回一个保守 fallback，保证插件仍能注册 agent。
 */
function readAgentPrompt(fileName: string): string {
  const file = join(packageRoot(), "agents", fileName);
  if (!existsSync(file)) {
    return [
      "你是 apollo-flowpower 的阶段子 agent。",
      "当前插件包缺少内置 agent prompt 文件，请只完成被委派的单一阶段任务，并返回中文结构化结果。",
    ].join("\n");
  }
  return readFileSync(file, "utf8").trim();
}

/**
 * 根据 subagent 名称读取用户显式配置的模型。
 */
function modelForPreset(preset: AgentPreset, modelConfig: SubagentModelConfig): string | undefined {
  return modelConfig[preset.name];
}

/**
 * 向 OpenCode 标准 `agent` 配置补齐 apollo-flowpower 的内置子 agent。
 *
 * 这里有一个很重要的边界：只在同名 agent 不存在时写入默认值。
 * 如果用户已经在 opencode 配置里定义了 `afp-context-agent` 等 agent，
 * 说明用户可能给它配置了专门模型、权限或自定义 prompt，插件必须完整尊重，
 * 不能合并覆盖其中任何字段。
 */
export function registerDefaultSubagents(config: MutableConfig, directory: string): void {
  const currentAgentConfig = Boolean(config.agent) && typeof config.agent === "object" && !Array.isArray(config.agent)
    ? (config.agent as Record<string, unknown>)
    : {};
  const modelConfig = getProjectSubagentModels(directory);

  for (const preset of AGENT_PRESETS) {
    if (Object.hasOwn(currentAgentConfig, preset.name)) continue;

    const agentConfig: Record<string, unknown> = {
      mode: "subagent",
      description: preset.description,
      prompt: readAgentPrompt(preset.promptFile),
      tools: preset.tools,
    };

    const model = modelForPreset(preset, modelConfig);
    if (model) {
      agentConfig.model = model;
    }

    currentAgentConfig[preset.name] = agentConfig;
  }

  config.agent = currentAgentConfig;
}
