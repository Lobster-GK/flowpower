# 生成生码计划

只使用 `frontend-codegen-plan` skill，生成或更新持久化的 `03-codegen-plan-spec.md`。

适用任务包括：

- 新页面、新组件、截图还原或文字生成 UI：基于 `01-ui-layout-spec.md`、`02-component-mapping-spec.md`、用户目标和项目资产生成计划。
- 现有功能变更：基于用户需求、相关现有代码、项目资产和可选 spec 生成计划。
- bug 修复：基于错误现象、复现步骤、日志/堆栈、相关代码和项目资产生成“先分析、再修复、后验证”的计划。
- 新增需求或小范围重构：基于现有实现、需求边界和验证方式生成计划。

不要生成代码，不要执行 API 集成、lint、启动、运行时检查或 UI review。

如果本次任务是新 UI 或大幅 UI 结构变更，但没有 layout spec 或 component mapping spec，先让用户补齐或改用 `/afp-ui-spec`。如果只是修改已有功能、修复 bug 或新增局部需求，不要强制要求 UI specs；应优先读取相关现有代码和证据。

如果任务范围无法定位、关键错误证据缺失且无法继续诊断，或存在阻塞性 Open Questions，先停止并说明需要补齐的信息。
