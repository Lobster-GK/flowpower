# 生成代码

优先按顺序使用 `frontend-codegen-plan` 和 `frontend-ui-codegen`：

1. 先根据用户目标、相关现有代码、错误证据、可选 UI specs 和项目资产生成或更新 `03-codegen-plan-spec.md`。
2. 再使用 `frontend-ui-codegen` 按计划生成或修改代码。

如果任务是新页面、新组件、截图还原、文字生成 UI 或大幅 UI 结构变更，必须先具备 `01-ui-layout-spec.md` 和 `02-component-mapping-spec.md`；缺失时让用户补齐或改用 `/afp-ui-spec`。

如果任务是现有功能变更、bug 修复、新增局部需求或小范围重构，不要强制要求 layout spec 或 component mapping spec；应以 `03-codegen-plan-spec.md` 的任务类型、File Plan、Implementation Steps、现有代码和错误证据为执行依据。

除非已经处在 apollo-flowpower 自动化生码流程中，并且流程明确要求记录产物，否则不要继续 API 集成、lint、启动或运行时检查。
