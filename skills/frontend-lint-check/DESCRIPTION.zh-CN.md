# frontend-lint-check 描述

## 干什么用

用于对目标前端目录执行静态检查并解释结果，重点覆盖 `npx apollo lint scan ./<targetDir>` 这类项目 lint 扫描。

## 什么时候用

- 用户要求“静态检查”“run lint”“lint this page”或“apollo lint scan”。
- 页面、组件或接口集成代码已经生成或修改，需要确认是否符合项目静态规则。
- 场景流程进入 lint 阶段，需要拿到可交给修复阶段的检查结果。

## 什么时候不用

- 不用于生成 UI、分析截图、设计 API 或修复后端 lint。
- 不用于开发服务器启动失败，也不用于浏览器 console 运行时错误。
- 不用于和目标生成目录无关的全项目泛化排查。
