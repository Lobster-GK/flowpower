# frontend-ui-review 描述

## 干什么用

用于审查 UI 还原度，通过对比已渲染页面或 DOM 截图与参考截图、layout spec、component mapping spec 或视觉需求，发现布局、样式、组件、文案和视觉细节偏差。

## 什么时候用

- 用户要求“UI 还原检查”“截图审查”“visual review”“compare with screenshot”或“restore accuracy”。
- 页面代码已经生成并能渲染，需要验证是否符合截图、spec 或视觉要求。
- 场景流程进入 UI review 阶段，需要输出可修复的视觉差异清单。

## 什么时候不用

- 不用于初始图片转 layout spec、组件映射或直接生成代码。
- 不用于 API 设计、lint 错误、启动错误或浏览器运行时错误。
- 不用于普通图片描述、非 UI 图片、后端调试或与当前页面无关的问题。
