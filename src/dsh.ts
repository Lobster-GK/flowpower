import type { Context } from "@deepseek-ai/cordis";
import { defineTool, type ParameterSchemaSpec } from "@deepseek-ai/dsh-tools";
import { AFP_TOOL_DESCRIPTIONS, executeAfpTool, type AfpToolName } from "./core-tools.js";
import { registerSubagents, validateConfig, type DshConfig } from "./dsh-agents.js";
import { projectDirectory, registerCommands, registerSkills } from "./dsh-resources.js";

export type Config = DshConfig;
export const name = "apollo-flowpower";
export const inject = ["tools", "skills", "commands", "subagents", "llm"];

/** Harness host plugin. Load alongside filesystem, skill-tool and spawn providers. */
export function apply(ctx: Context, config: Config = {}): void {
  validateConfig(config);
  for (const name of Object.keys(AFP_TOOL_DESCRIPTIONS) as AfpToolName[]) {
    const parameters: ParameterSchemaSpec = name === "afp_load_scene_template"
      ? { scene: { type: "string", required: true, description: "Scene id from afp_list_scenes." } }
      : { reason: { type: "string" }, scene: { type: "string" }, stage: { type: "string" },
        request: { type: "string" }, input: { type: "json" } };
    ctx.tools.register(defineTool({
      name, description: AFP_TOOL_DESCRIPTIONS[name], parameters,
      output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
      // These calls may seed missing config/templates, so do not mark concurrency-safe.
      async execute(args, exec) {
        exec.signal.throwIfAborted();
        const result = executeAfpTool(name, projectDirectory(exec.agent), typeof args.scene === "string" ? args.scene : undefined);
        return JSON.parse(result.output);
      },
      presentCall: () => ({ card: "generic", title: AFP_TOOL_DESCRIPTIONS[name].split(".")[0] }),
    }));
  }
  registerSkills(ctx);
  registerCommands(ctx);
  registerSubagents(ctx, config);
}

export default { name, inject, apply };
