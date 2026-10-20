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
export declare const AGENT_PRESETS: AgentPreset[];
