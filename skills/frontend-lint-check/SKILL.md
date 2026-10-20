---
name: frontend-lint-check
description: >
  用于对目标生成或修改目录执行前端静态检查并解释结果，尤其是 `npx apollo lint scan ./<targetDir>`。适合在用户要求
  “静态检查”“run lint”“lint this page”“apollo lint scan”或需要确认本次前端改动是否通过 lint 时使用。不适合 UI 生成、
  截图分析、后端 lint、API 设计、启动失败、浏览器运行时错误，或与目标前端改动无关的泛化调试。
---

# Lint 检查阶段

所有输出使用中文。

## 使用场景

- 用户只要求执行静态检查。
- 用户通过 `/afp-lint-check` 命令进入 lint 阶段。
- apollo-flowpower 自动化流程进入 lint 阶段。

本 Skill 只负责 lint 检查动作本身：执行检查、理解输出、修复并重试。不要在本 Skill 内继续启动检查；需要全流程编排时，由 `/afp-scene` 显式触发并加载的场景模板 YAML 决定下一阶段。

## 执行流程

1. 明确待检查目录 `targetDir`。
2. 在项目根目录执行 `npx apollo lint scan ./<targetDir>`。
3. 返回或命令退出码为 0 时，说明静态检查通过。
4. 返回 `fix_required` 或命令失败时，读取 stdout、stderr、错误文件和报告产物。
5. 使用 `frontend-error-fix` skill，只修复相关生成文件。
6. 修复后再次执行 lint 检查，直到通过或确认被阻塞。

## 修复约束

- 不要修改无关业务文件。
- 不要为了通过 lint 删除 UI 结构、字段、按钮或交互入口。
- 优先修复语法、类型、未使用变量、导入路径、组件 API、样式变量和格式问题。
- 不要把 lint 日志、错误文本或修复过程写入页面 UI。
