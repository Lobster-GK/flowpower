# 现有流程接入说明

本 skill 不要求废弃现有三份规格，而是改变视觉事实的承载与验收位置。

## 产物关系

| 现有产物/阶段 | 继续负责 | 移出或新增职责 |
| --- | --- | --- |
| `01-ui-layout-spec.md` | 稳定 region/element ID、元素覆盖、可见层级、状态 | 精确 bbox、排版、颜色、容差进入 `01-visual-contract.json` |
| `02-component-mapping-spec.md` | 语义组件、props、数据、交互、状态归属 | 视觉兼容度、覆盖入口进入 `02-component-adaptation.json` |
| `03-codegen-plan-spec.md` | 文件计划、实现步骤、状态和验证命令 | 增加 visual ID、固定视口截图入口和视觉迭代预算 |
| `frontend-ui-codegen` | 按计划生成首版代码 | 不再把视觉细节视为可无限后置的软约束 |
| `frontend-ui-review` | 可保留人工审查入口 | 用本 skill 的分区指标、iteration report 和 repair brief 替代“明显偏差”描述 |

接口驱动页面在生码后、首次浏览器截图前增加 fixture contract/lock。已有 mock 只作为响应实现来源，必须去掉随机数据并纳入请求哈希、次数和可见状态门禁。

## 推荐阶段顺序

```text
frontend-ui-vision-spec
  -> frontend-component-mapping-spec
  -> frontend-visual-fidelity-loop: visual-contract + component-adaptation
  -> frontend-codegen-plan
  -> frontend-ui-codegen
  -> lint / boot / runtime
  -> frontend-visual-fidelity-loop: render / diff / repair / acceptance
```

如果上层编排不支持同一 skill 两次出现，可把前半段产物准备和后半段收敛放入一个视觉还原 stage，并在生码前后各执行对应步骤。

## 优先级修正

现有规则中“不得为了看起来更像而破坏组件映射”应解释为：

- 不破坏语义、数据、交互和可访问性归属；
- 允许根据 `component-adaptation` 更换外观承载方式、增加 wrapper、使用 headless 行为层或补充局部覆盖；
- 若现有组件无法稳定满足关键视觉契约，必须回到适配阶段重选策略，而不是接受默认外观。

## 多执行者修正

将“三个执行者各自完成同一份识别后汇总”替换为：

1. 语义观察者输出元素/状态补丁；
2. 视觉测量者输出数值和证据；
3. 契约审计者输出字段级冲突；
4. canonical writer 合并一次。

生码后的批评者和修复者必须分离。批评者不能改代码，修复者不能绕过 iteration report 自行扩展范围。
