import type { Context } from "@deepseek-ai/cordis";
import type { Agent, AgentOptions } from "@deepseek-ai/dsh-agent";
import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { type ToolRestriction } from "@deepseek-ai/dsh-tools";
/** Explicit same-name overrides replace the built-in role in full. */
export interface DshAgentOverride {
    persona: string;
    toolFilter: ToolRestriction;
    agentOptions?: AgentOptions;
}
export interface DshConfig {
    /** Provider registered with ctx.subagents, not an LLM provider. */
    subagentProvider?: string;
    /** Exact model string from AFP config -> Harness route. Useful across hosts. */
    modelRoutes?: Record<string, {
        provider: string;
        model: string;
    }>;
    agents?: Record<string, DshAgentOverride>;
}
export declare function validateConfig(config: DshConfig): void;
/** Only visible task attachments; never resurrect compacted or hidden raw events. */
export declare function taskAttachments(agent: Agent): ContentBlock[];
export declare function registerSubagents(ctx: Context, config: DshConfig): void;
