type MutableConfig = Record<string, unknown>;
/**
 * 向 OpenCode 标准 `agent` 配置补齐 apollo-flowpower 的内置子 agent。
 *
 * 这里有一个很重要的边界：只在同名 agent 不存在时写入默认值。
 * 如果用户已经在 opencode 配置里定义了 `afp-context-agent` 等 agent，
 * 说明用户可能给它配置了专门模型、权限或自定义 prompt，插件必须完整尊重，
 * 不能合并覆盖其中任何字段。
 */
export declare function registerDefaultSubagents(config: MutableConfig, directory: string): void;
export {};
