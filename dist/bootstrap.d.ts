/**
 * 生成注入到第一条用户消息里的 bootstrap prompt。
 *
 * 注入内容来自 `src/rule.md`，不再内联拼接，也不再读取
 * `codegen-superpower-workflow` skill。这样规则文本可以独立维护。
 */
export declare function buildBootstrapPrompt(): string;
/**
 * 把 bootstrap 注入到第一条 user 消息。
 *
 * OpenCode 当前消息结构通常是 `{ info: { role }, parts: [...] }`；
 * 这里优先向 `parts` 前面插入 text part，同时兼容旧的 `role/content` 结构。
 */
export declare function injectBootstrap(messages: Array<Record<string, unknown>>): void;
