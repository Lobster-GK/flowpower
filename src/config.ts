import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 项目内 AFP 运行时目录。
 *
 * 注意：这是用户项目中的可编辑目录，不是插件包自身目录。
 * 插件只会补齐缺失文件，不会覆盖用户已经修改过的模板或配置。
 */
export const AFP_PROJECT_DIRECTORY = [".opencode", "apollo-flowpower"] as const;

/**
 * 面向文档、工具描述和返回结果的路径展示形式。
 */
export const AFP_PROJECT_DIRECTORY_DISPLAY = ".opencode/apollo-flowpower";

/**
 * 返回插件包根目录。
 *
 * 编译后入口位于 `dist/*.js`，源码运行时位于 `src/*.ts`；这两种情况下
 * `dirname(dirname(import.meta.url))` 都能回到 `apollo-flowpower` 包根目录。
 */
export function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
