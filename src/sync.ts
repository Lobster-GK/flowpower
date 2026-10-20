import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { packageRoot } from "./config.js";

/**
 * JSON 配置解析后的类型守卫。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * 缺失文件复制工具，所有同步逻辑都通过它避免覆盖用户修改。
 */
function copyIfMissing(source: string, target: string, created: string[]): void {
  if (existsSync(target)) return;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  created.push(target);
}

/**
 * 递归复制目录中的缺失文件，主要用于目录型 skill。
 */
function copyDirectoryFilesIfMissing(sourceDir: string, targetDir: string, created: string[]): void {
  mkdirSync(targetDir, { recursive: true });

  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name);
    const target = join(targetDir, name);
    if (statSync(source).isDirectory()) {
      copyDirectoryFilesIfMissing(source, target, created);
      continue;
    }
    copyIfMissing(source, target, created);
  }
}

/**
 * 把插件内置 commands 同步到项目 .opencode/commands。
 */
function syncCommands(directory: string, root: string, created: string[]): void {
  const sourceDir = join(root, "commands");
  if (!existsSync(sourceDir)) return;

  const targetDir = join(directory, ".opencode", "commands");
  mkdirSync(targetDir, { recursive: true });

  for (const name of readdirSync(sourceDir)) {
    if (!name.endsWith(".md")) continue;
    copyIfMissing(join(sourceDir, name), join(targetDir, name), created);
  }
}

/**
 * 把插件内置 skills 同步到项目 .opencode/skills。
 */
function syncSkills(directory: string, root: string, created: string[]): void {
  const sourceDir = join(root, "skills");
  if (!existsSync(sourceDir)) return;

  const targetRoot = join(directory, ".opencode", "skills");
  mkdirSync(targetRoot, { recursive: true });

  for (const name of readdirSync(sourceDir)) {
    const source = join(sourceDir, name);
    if (statSync(source).isDirectory()) {
      const sourceSkill = join(source, "SKILL.md");
      if (existsSync(sourceSkill)) {
        copyDirectoryFilesIfMissing(source, join(targetRoot, name), created);
      }
      continue;
    }

    if (name.endsWith(".md")) {
      const skillName = parse(name).name;
      copyIfMissing(source, join(targetRoot, skillName, "SKILL.md"), created);
    }
  }
}

/**
 * 可选同步内置 commands 和 skills。
 */
export function syncBuiltinResources(directory: string): string[] {
  const root = packageRoot();
  const created: string[] = [];
  syncCommands(directory, root, created);
  // syncSkills(directory, root, created);
  return created;
}

/**
 * 读取旧的 OpenCode 项目配置，用于判断是否开启资源同步。
 */
function readProjectConfig(directory: string): Record<string, unknown> | null {
  const file = join(directory, ".opencode", "config.json");
  if (!existsSync(file)) return null;

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 用户显式开启 syncBuiltinResources 时才同步内置资源。
 */
export function shouldSyncBuiltinResources(directory: string): boolean {
  return readProjectConfig(directory)?.syncBuiltinResources === true;
}
