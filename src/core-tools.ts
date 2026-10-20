import { AFP_PROJECT_DIRECTORY_DISPLAY } from "./config.js";
import { runDoctor } from "./doctor.js";
import { ensureProjectConfig, getProjectConfig, migrateProjectConfig } from "./project-config.js";
import { ensureProjectSceneTemplates, listSceneTemplates, loadSceneTemplate } from "./scenes.js";

/** Host-independent initialization. AFP data stays in its existing shared directory. */
export function initializeProject(directory: string): void {
  if (!ensureProjectConfig(directory)) migrateProjectConfig(directory);
  ensureProjectSceneTemplates(directory);
}

export const AFP_TOOL_DESCRIPTIONS = {
  afp_list_scenes: "List available Apollo Flowpower scene templates from the current project. Use only after the user explicitly invokes Apollo Flowpower scene orchestration. Return only scene metadata; choose a scene, then call afp_load_scene_template.",
  afp_load_scene_template: "Load one Apollo Flowpower scene template YAML from the current project by scene id. Use only after selecting a scene from afp_list_scenes or when the user explicitly provides scene=<id>.",
  afp_get_project_config: `Parse ${AFP_PROJECT_DIRECTORY_DISPLAY}/config.yaml and return validated Apollo Flowpower project configuration, including project assets and subagent model settings. Use before each scene stage to inspect project assets and decide which asset files to read directly.`,
  afp_doctor: "Run Apollo Flowpower project diagnostics. Use when the user invokes /afp-doctor or asks to inspect plugin health, config migration, scene template validity, duplicate scene ids, missing assets, or unknown skill/subagent references.",
} as const;

export type AfpToolName = keyof typeof AFP_TOOL_DESCRIPTIONS;
export interface AfpToolResult {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
}

/** Preserve OpenCode's envelope; output is the common JSON business contract. */
export function executeAfpTool(name: AfpToolName, directory: string, scene?: string): AfpToolResult {
  switch (name) {
    case "afp_list_scenes": {
      const result = listSceneTemplates(directory);
      return { title: "Apollo Flowpower scenes", output: JSON.stringify(result, null, 2),
        metadata: { sceneCount: result.scenes.length, errorCount: result.errors.length } };
    }
    case "afp_load_scene_template": {
      if (typeof scene !== "string") throw new Error("scene must be a string");
      const result = loadSceneTemplate(directory, scene);
      return { title: result.scene ? `Apollo Flowpower scene: ${result.scene.id}` : "Apollo Flowpower scene not found",
        output: JSON.stringify(result, null, 2), metadata: { scene: result.scene?.id,
          stageCount: result.stages?.length ?? 0, executionPlanCount: result.executionPlan?.length ?? 0,
          errorCount: result.errors.length } };
    }
    case "afp_get_project_config": {
      const result = getProjectConfig(directory);
      return { title: "Apollo Flowpower project config", output: JSON.stringify(result, null, 2),
        metadata: { assetCount: result.assets.length, subagentCount: result.subagents.length,
          configuredSubagentModelCount: result.subagents.filter((item) => item.configuredModel).length,
          errorCount: result.errors.length } };
    }
    case "afp_doctor": {
      const result = runDoctor(directory);
      return { title: `Apollo Flowpower doctor: ${result.status}`, output: JSON.stringify(result, null, 2),
        metadata: { status: result.status, errorCount: result.summary.error, warningCount: result.summary.warning,
          infoCount: result.summary.info, sceneCount: result.scenes.sceneCount, configMigrated: result.config.migrated } };
    }
  }
}
