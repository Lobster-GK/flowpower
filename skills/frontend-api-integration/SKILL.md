---
name: frontend-api-integration
description: >
  用于基于用户明确提供的接口文档为前端页面接入 API，包括 service 调用、请求/响应类型、endpoint 连接和数据加载行为。适合在用户提供
  Swagger/OpenAPI/curl、接口 Markdown、TypeScript 类型文件等资料，并要求“集成接口”“接接口”“connect this page to API”
  或“integrate API logic”时使用。不适合 API 设计、后端实现、数据库 schema、纯 mock 数据、UI 布局生成、lint 修复、启动调试，
  或用户没有提供接口文档的场景。
---

# 接口集成

如果需要为本阶段指定模型，优先查看 `afp_get_project_config` 返回的 `subagents` 中 `afp-builder-agent.model`；为空时使用当前 OpenCode 会话默认模型。

这个 Skill 的产物是接口逻辑集成结果；不要在本 Skill 内继续 lint、启动或运行时检查。需要全流程编排时，由 `/afp-scene` 显式触发并加载的场景模板 YAML 决定下一阶段。

接口文档只接受用户显式指定：

- 用户在流水线开始时附带的 OpenAPI/Swagger JSON/YAML、Markdown、curl 文档或 TypeScript interface 文件。
- 不自动扫描项目根目录、`docs/api/` 或其它默认路径。
- 用户未指定接口文档时，直接跳过接口集成。

集成规则：
- API 访问统一通过 `src/services/api.ts`。
- 每个契约接口生成一个 endpoint function。
- 如果存在 `src/services/api-types.ts`，优先使用其中类型。
- 组件内默认使用 `useEffect` + `useState`，除非项目已经使用 React Query。
- 如果用户没有显式指定接口文档，记录 `skipped: "no-api-doc-provided-by-user"`。
- 说明、注释和报告使用中文；代码标识符、路径、API 字段和 JSON key 保持英文。
