/** Host-independent initialization. AFP data stays in its existing shared directory. */
export declare function initializeProject(directory: string): void;
export declare const AFP_TOOL_DESCRIPTIONS: {
    readonly afp_list_scenes: "List available Apollo Flowpower scene templates from the current project. Use only after the user explicitly invokes Apollo Flowpower scene orchestration. Return only scene metadata; choose a scene, then call afp_load_scene_template.";
    readonly afp_load_scene_template: "Load one Apollo Flowpower scene template YAML from the current project by scene id. Use only after selecting a scene from afp_list_scenes or when the user explicitly provides scene=<id>.";
    readonly afp_get_project_config: "Parse .opencode/apollo-flowpower/config.yaml and return validated Apollo Flowpower project configuration, including project assets and subagent model settings. Use before each scene stage to inspect project assets and decide which asset files to read directly.";
    readonly afp_doctor: "Run Apollo Flowpower project diagnostics. Use when the user invokes /afp-doctor or asks to inspect plugin health, config migration, scene template validity, duplicate scene ids, missing assets, or unknown skill/subagent references.";
};
export type AfpToolName = keyof typeof AFP_TOOL_DESCRIPTIONS;
export interface AfpToolResult {
    title: string;
    output: string;
    metadata: Record<string, unknown>;
}
/** Preserve OpenCode's envelope; output is the common JSON business contract. */
export declare function executeAfpTool(name: AfpToolName, directory: string, scene?: string): AfpToolResult;
