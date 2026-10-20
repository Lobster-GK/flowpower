# frontend-error-fix 描述

## 干什么用

用于根据明确错误报告修复前端问题。它强调先收集证据、分析根因、制定修改计划，再做最小必要修改，并把结果交回原检查阶段验证。

## 什么时候用

- lint、启动、运行时或 UI review 已经返回具体错误、失败文件、控制台报错或可复现现象。
- 用户要求“根据检查结果修复”“fix lint errors”“fix boot error”“fix runtime error”或“repair generated files”。
- 场景流程中的某个检查阶段失败，并声明了 `onFail: fix-and-retry`。

## 什么时候不用

- 不用于从零创建 UI、截图转 spec、接口设计或后端实现。
- 不用于没有错误报告的猜测性优化，也不主动做大范围重构。
- 不用于与当前失败无关的代码清理、性能优化或风格调整。
