import { type Plugin } from "@opencode-ai/plugin";
/**
 * OpenCode 插件入口。
 *
 * 初始化阶段会补齐项目级 config.yaml 和 scene template 种子；
 * 这些写入都采用缺失文件复制策略，不覆盖用户已有文件。
 */
export declare const ApolloFlowpower: Plugin;
export declare const server: Plugin;
export default ApolloFlowpower;
