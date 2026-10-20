---
name: frontend-ui-review
description: >
  用于审查 UI 还原度，通过对比已渲染页面或 DOM 截图与参考截图、layout spec、component mapping spec 或视觉需求发现偏差。适合在用户要求
  “UI 还原检查”“截图审查”“visual review”“compare with screenshot”或需要检查页面是否符合视觉目标时使用。不适合初始图片转 spec、
  直接生码、API 设计、lint 错误、启动错误、普通图片描述、非 UI 图片、后端调试或无关前端问题。
---

# UI 截图审查阶段

所有输出使用中文。

## 使用场景

- 用户只要求做 UI 还原检查。
- 用户通过 `/afp-ui-review` 命令进入 UI 截图审查阶段。
- 图片生码自动化流程进入 UI review 阶段。

本 Skill 只负责 UI 截图审查动作本身：获取截图、对比参考图、layout spec 和 component mapping spec，判断是否需要视觉修复。不要在本 Skill 内继续其它阶段；需要全流程编排时，由 `/afp-scene` 显式触发并加载的场景模板 YAML 决定是否记录最终状态。

## 执行流程

1. 获取参考图、layout spec、component mapping spec 和实际页面截图。
2. 如果缺少 DOM 截图，使用 chrome-devtools-mcp 或可用浏览器能力截取根 DOM。
3. 按 `frontend-ui-layout-spec`、`frontend-component-mapping-spec` 与 `frontend-ui-codegen` 的约束做视觉审查。
4. 如果发现明显偏差，只修复本次生成文件。
5. 修复后重新获取截图并再次审查。
6. 如果没有明显偏差，输出 UI 审查结论。

## 审查重点

- 布局区域、组件映射、可见文案、表单/表格结构、分隔线、间距、颜色和状态。
- 不要补充 spec 中不存在的 UI 元素。
- 不要为了“更好看”增加装饰性结构。
