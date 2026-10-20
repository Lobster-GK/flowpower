# frontend-ui-codegen 描述

## 干什么用

用于根据 `03-codegen-plan-spec.md` 实施 React 18 + TypeScript + Vite 前端代码生成或修改。它负责把计划中的 File Plan、Implementation Steps、状态/数据/样式策略和契约映射真正落到代码里。

## 什么时候用

- `frontend-codegen-plan` 已经生成或更新 `03-codegen-plan-spec.md`，并且计划里的任务类型、目标文件、实施步骤和验证方式明确。
- 新页面、新组件或大幅 UI 变更已经同时具备 layout spec、component mapping spec 和 codegen plan spec，准备按契约写代码。
- 修改已有功能、新增局部需求或小范围重构时，计划已经列出相关现有代码、变更边界和文件计划。
- 修复前端 bug 时，计划已经给出错误证据、目标文件、根因或可执行修复路径。

## 什么时候不用

- 不用于截图分析、布局说明、组件映射、属性归属或生成生码计划。
- 不用于后端代码、API 设计、独立错误排查、lint 修复、启动失败排查或浏览器运行时调试。
- 不用于在缺少 `03-codegen-plan-spec.md` 时临时猜测文件结构、修改范围或实现步骤。
- 不用于绕过 plan/spec 发明未指定 UI、字段、交互、接口参数、业务数据或额外重构。
