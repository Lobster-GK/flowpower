---
name: frontend-runtime-check
description: >
  用于在浏览器中检查前端页面，包括路由加载、console 错误、页面可用性和根 DOM 截图。适合在开发服务已可访问，用户要求
  “运行时检查”“页面运行报错”“check console errors”“open page route”或“browser validation”时使用。不适合代码生成、
  API 设计、仅 lint 错误、开发服务启动失败、后端问题、非浏览器测试，或无关前端调试。
---

# 运行时检查阶段

所有输出使用中文。

## 使用场景

- 用户只要求执行运行时检查。
- 用户通过 `/afp-runtime-check` 命令进入运行时阶段。
- apollo-flowpower 自动化流程进入 runtime 阶段。

本 Skill 只负责运行时检查动作本身：打开页面、跳转 route、检查控制台、截图、修复并重试。不要在本 Skill 内继续 UI 检查；需要全流程编排时，由 `/afp-scene` 显式触发并加载的场景模板 YAML 决定下一阶段。

## 执行流程

1. 如果需要为本阶段指定模型，优先查看 `afp_get_project_config` 返回的 `subagents` 中 `afp-verifier-agent.model`；为空时继续使用当前会话默认模型。
2. 准备页面访问地址、`route`、`rootDomId` 和相关生成文件列表；缺失时先从上下文、生成目录和代码中推断，仍无法确定则询问用户。
3. 页面访问地址优先使用用户明确给出的地址；否则结合启动检查输出的本机地址和本次 route。
4. 使用 chrome-devtools-mcp 打开页面。
5. 如果出现登录页，根据用户在当前对话中提供的账号、密码或操作说明完成登录；如果自动登录不可行，要求用户协助完成登录后继续。
6. 根据用户说明、项目实际路由方式和页面表现进入本次生成页面 route；不要写死 history.push。
7. 等待 `#rootDomId` 出现。
8. 检查与生成文件相关的控制台错误，并截取根 DOM。
9. 没有相关错误时，说明运行时检查通过。
10. 存在相关错误时，使用 `frontend-error-fix` skill，只修复相关文件。
11. 修复后再次执行运行时检查，直到通过或确认被阻塞。

## 修复约束

- 只处理与本次生成文件相关的 console error。
- 不要因为第三方库、浏览器扩展或无关页面错误修改本次代码。
- 如果根 DOM 不存在，优先检查生码阶段是否正确添加 `rootDomId`。
- 不要为了规避运行时错误删除主要 UI 结构。
