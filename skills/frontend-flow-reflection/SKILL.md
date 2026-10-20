---
name: frontend-flow-reflection
description: >
  对一次前端 AI 开发任务、一次 apollo-flowpower 场景编排、一个 `.codegen/artifacts` 产物目录、一次 bug 修复/生码/API 集成/质量检查过程做中文复盘，
  生成或更新持久化 `04-reflection-report.md`。用于总结有效决策、失败原因、遗漏资产、可沉淀项目规范、scene template 调整建议、skill/agent 改进建议和后续 TODO。
  适合用户调用 `/afp-reflect`、要求“复盘这次流程”“沉淀经验”“看看应该补哪些资产/模板/规范”时使用。不用于继续写业务代码、执行质量检查、
  修改 scene/资产/配置，除非用户明确授权 apply 模式。
---

# 前端流程复盘

输出必须使用中文。本 skill 负责复盘和沉淀建议，不继续生码、不修复错误、不执行质量检查。

## 核心边界

- 默认只生成复盘报告和建议，不修改任何文件。
- 必须先调用 `afp_get_project_config`，读取项目资产索引和 subagent 配置。
- 只读取和本次复盘直接相关的证据：artifact 目录、相关 spec、执行清单、错误日志、验证结果、用户指定文件、相关资产。
- 不要把项目资产正文全量读入；只读取当前复盘需要判断的资产。
- 不要把一次偶发现象直接上升为项目规则；建议必须标注证据强弱。
- 用户明确 `apply=true` 或要求落地前，不能修改 `config.yaml`、scene template、项目资产、skill、agent prompt 或业务代码。

## 输入判断

先识别复盘对象：

- `scene-run`：一次 `/afp-scene` 完整或部分流程。
- `artifact-review`：一个 `.codegen/artifacts/<task>` 目录。
- `codegen-task`：一次 UI 生码或功能变更。
- `bug-fix-task`：一次错误分析和修复。
- `api-integration-task`：一次接口接入。
- `quality-task`：一次 lint、boot、runtime 或 UI review。
- `process-only`：用户只要求复盘对话或流程，没有明确文件。

如果用户指定 `artifact=<path>`，优先读取该目录下的 spec、计划、报告和日志。没有 artifact 时，基于当前对话和用户指定文件做最小范围复盘。

## 证据收集

按需收集：

- 用户原始目标和最终结果。
- `01-ui-layout-spec.md`、`02-component-mapping-spec.md`、`03-codegen-plan-spec.md`、已有 `04-reflection-report.md`。
- scene YAML、`executionPlanTable`、阶段状态更新和跳过/失败原因。
- lint、boot、runtime、UI review 的输出证据。
- 相关代码 diff、关键文件或错误日志。
- `afp_get_project_config` 返回的 `assets` 和 `subagents`。
- 已读取的项目资产正文。

不要为了复盘全量扫描仓库。

## 分析维度

至少覆盖这些维度：

| 维度 | 要回答的问题 |
| --- | --- |
| 目标达成 | 用户目标是否达成，哪些部分未覆盖 |
| 流程执行 | 阶段顺序、状态更新、跳过和失败是否合理 |
| 产物质量 | layout spec、component mapping、codegen plan、代码、验证报告是否足够支撑后续 |
| 资产使用 | 是否读取了相关资产，是否缺少资产，资产说明是否足够让模型判断 |
| 组件映射 | 组件选择、props/slot/children、状态和交互归属是否清晰 |
| 错误修复 | 是否先分析再计划再实施，是否有最小修复和验证闭环 |
| 多 agent | 如果启用，是否同轮并行、各自完整观察、最终合并是否保留分歧 |
| 模型配置 | subagent 模型配置是否匹配任务类型，视觉任务是否有合适多模态模型 |
| 可沉淀项 | 哪些经验应该写入资产、模板、skill、agent 或团队流程 |

## 建议分级

每条建议必须包含：

- `类别`：`asset`、`config`、`scene-template`、`skill`、`agent`、`quality`、`process`。
- `优先级`：`high`、`medium`、`low`。
- `证据强度`：`strong`、`medium`、`weak`。
- `建议动作`：具体到文件、字段或流程。
- `不建议自动落地的原因`：如果需要人工判断，必须说明。

## 产物

默认写入：

```text
.codegen/artifacts/<语义化任务名或时间戳>/04-reflection-report.md
```

如果用户指定 `target=<path>`，写入用户指定路径。如果无法写文件，在回复中给出完整报告，并说明未持久化原因。

## 输出结构

报告必须包含以下章节，顺序保持一致。

## Summary

- 复盘对象。
- 用户目标。
- 最终结果。
- 结论：`success`、`partial`、`failed` 或 `unknown`。
- 报告路径。

## Evidence

列出实际读取的证据：

| 证据 | 路径/来源 | 用途 |
| --- | --- | --- |

## Flow Review

复盘流程执行：

| 阶段 | 状态 | 观察 | 问题 | 改进建议 |
| --- | --- | --- | --- | --- |

如果没有明确阶段，写“不适用”，并说明本次复盘基于任务结果和对话证据。

## Artifact Review

复盘产物质量：

| 产物 | 状态 | 主要问题 | 是否需要补充 |
| --- | --- | --- | --- |

## Asset Gaps

列出项目资产缺口：

| 缺口 | 建议资产路径 | 应包含内容 | 优先级 | 证据强度 |
| --- | --- | --- | --- | --- |

如果没有资产缺口，写“未发现明确资产缺口”。

## Scene And Process Improvements

列出 scene template 或流程建议：

| 对象 | 建议 | 原因 | 风险 | 是否适合自动落地 |
| --- | --- | --- | --- | --- |

## Skill And Agent Improvements

列出 skill 或 agent 建议：

| 对象 | 建议 | 原因 | 证据强度 |
| --- | --- | --- | --- |

如果只是项目使用问题，不要强行建议修改插件 skill 或 agent。

## Actionable TODO

输出可执行 TODO：

| 优先级 | 类别 | 动作 | 目标文件/位置 | 是否需要用户确认 |
| --- | --- | --- | --- | --- |

## Apply Plan

如果用户没有明确授权 apply，写：

```text
当前为 review-only 模式，未修改任何配置、模板、资产或代码。
```

如果用户明确授权 apply，先列出拟修改文件、修改理由和回滚方式，等待用户确认具体范围后再修改。

## apply 模式规则

进入 apply 模式时：

1. 先输出“拟落地清单”，不要立刻改文件。
2. 用户确认具体条目后，才修改对应文件。
3. 一次只处理用户确认的范围。
4. 修改项目资产时，优先追加小节或补充示例，不要重写整篇文档。
5. 修改 scene template 时，只改确认的字段，并保持 YAML 可解析。
6. 修改 `config.yaml` 时，只补充确认的 `assets` 项或 subagent 模型配置。
7. 修改插件源码、命令、skill 或 agent prompt 时，必须是用户明确要求，不因普通复盘建议自动执行。
