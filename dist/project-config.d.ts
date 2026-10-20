import { type AgentModelKind } from "./agent-presets.js";
/**
 * 暴露给模型的项目资产索引项。
 */
type ProjectAsset = {
    description: string;
    path: string;
    exists: boolean;
    size?: number;
};
/**
 * 暴露给模型的内置 subagent 模型配置项。
 */
type ProjectSubagentConfig = {
    name: string;
    modelKind: AgentModelKind;
    model: string | null;
    configuredModel: boolean;
};
/**
 * afp_get_project_config 工具返回的数据结构。
 */
type ProjectConfigResult = {
    configFile: string;
    createdConfig: boolean;
    migratedConfig: boolean;
    migrations: string[];
    schemaVersion?: number;
    subagents: ProjectSubagentConfig[];
    assets: ProjectAsset[];
    errors: string[];
};
/**
 * 注册默认 subagent 时使用的模型映射。
 */
type ProjectSubagentModelConfig = Record<string, string>;
/**
 * 项目级 config.yaml 的绝对路径。
 */
export declare function projectConfigFile(directory: string): string;
/**
 * 确保项目存在 AFP 配置文件。
 *
 * 如果目标文件已经存在，直接返回 false，不覆盖用户配置。
 */
export declare function ensureProjectConfig(directory: string): boolean;
/**
 * 在不覆盖用户已有值的前提下，给旧版 config.yaml 补齐当前插件需要的默认配置项。
 *
 * 如果配置文件本身不可解析、不是对象，或已有字段类型冲突，迁移会跳过对应部分，
 * 让 afp_get_project_config 和 afp_doctor 报告结构化错误。
 */
export declare function migrateProjectConfig(directory: string): string[];
/**
 * 对外暴露的配置解析入口。
 */
export declare function getProjectConfig(directory: string): ProjectConfigResult;
/**
 * 读取项目配置里的 subagent 模型设置，供 OpenCode agent 注册阶段使用。
 */
export declare function getProjectSubagentModels(directory: string): ProjectSubagentModelConfig;
export {};
