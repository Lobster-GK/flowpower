你已经成功加载 apollo-flowpower 插件，当你执行apollo-flowpower 的某个场景流程时你必须严格遵循下面的约定。

<EXTREMELY-IMPORTANT>
只要你被要求执行一个场景任务，那你**绝对必须**严格按照那个场景的步骤执行，一步都不能跳过，一步都不能多，场景流程中未配置的思考、生码、质量检测严格禁止自己推测添加并执行。如果后续的工作内容里明确指明了你需要使用那个工具或者skill，或者把任务派发给子agent，那你必须无条件的执行。
`afp_list_scenes` 和 `afp_get_project_config` 调用时禁止传参。`afp_load_scene_template` 调用时必须传 scene id 字符串，例如 `{scene: "text-to-page"}`, 不要传列表序号、展示名称或整个 scene 对象。
</EXTREMELY-IMPORTANT>


# 使用skill

## 规则

**在执行某个流程节点时，如果被要求使用某个技能，你必须严格遵循，必须且只能使用这个技能**

## 可用核心 skills

- `mastergo-dsl-to-react`：将MasterGo DSL文件转换为React页面。
- `fontend-unit-test-rule`: 前端单元测试编写方法论。
- `cmbc-apollo-code-generator`: apollo v3 框架规范指引。
- `frontend-ui-layout-spec`：从截图、图片或文字需求生成布局说明、ASCII 原型图和 UI 元素盘点。
- `frontend-component-mapping-spec`：基于布局说明生成组件映射与属性归属。
- `frontend-codegen-plan`：在生码、改码或修复前生成持久化计划，记录任务类型、文件、步骤、状态、样式和验证方式。
- `frontend-ui-codegen`：根据生码计划、可选布局说明/组件映射和现有代码生成或修改前端代码。
- `frontend-api-integration`：根据明确接口文档完成 API 集成。
- `frontend-lint-check`：执行 lint 检查和相关修复流程。
- `frontend-boot-check`：执行启动检查和相关修复流程。
- `frontend-runtime-check`：执行浏览器运行时检查。
- `frontend-ui-review`：执行视觉还原度审查。
- `frontend-error-fix`：根据明确错误报告分析原因、制定计划并做最小修复。
- `frontend-flow-reflection`：复盘一次前端 AI 开发流程，生成 `reflection-report.md`，沉淀资产、模板、skill 和 agent 改进建议。

# 使用子 agent

## 规则

**在执行某个流程节点时，如果被要求使用某个子agent，你必须严格遵循，必须把任务委派给子任务，如果流程节点同时指明了skill，你必须把这个skill告知给子agent**

## 可用子 agent

- `afp-context-agent`：上下文侦察，读取相关事实和项目约定。
- `afp-observer-agent`：观察输入，整理可见事实、状态差异和不确定项。
- `afp-planner-agent`：制定或审查可执行计划。
- `afp-builder-agent`：按明确范围实施代码、文档或配置改动。
- `afp-verifier-agent`：执行检查并返回结构化证据。
- `afp-review-agent`：独立审查需求、计划、改动、证据和流程风险。

- 如果用户使用了 `afp-ui-spec-agent` 就替换成 `afp-observer-agent`。
- 如果用户使用了 `afp-lint-check-agent` 就替换成 `afp-verifier-agent`。
- 如果用户使用了 `afp-boot-check-agent` 就替换成 `afp-verifier-agent`。
- 如果用户使用了 `afp-runtime-check-agent` 就替换成 `afp-verifier-agent`。


## 子agent调用约束

调用任何子agent前，必须生成完整的任务规格交给子agent。

**严禁自由发挥生成任务规格交个子agent**

任务规格必须包含如下内容：

1.目标
  - 子agent最终要解决什么问题，输出什么东西，明确是输出一个实际文件还是返回一段文本
  - 如果目标是输出一个文件，必须明确告知子agent输出目录以及文件名
2.输入
  - 明确所有输入文件的绝对路径或相对路径
  - 需要用到的项目资产，例如开发规范、组件文档等
3.背景
  - 提供完成任务所需的背景
4.约束条件
  - 明确允许做什么
  - 明确禁止做什么
  - 如果指明了使用什么skill技能、mcp、文档等，必须明文写入约束条件，要求使用什么skill技能、mcp、文档等。
5.输出
  - 指定输出格式
  - 指定必须包含的内容

# spec生成约束

如果某个流程节点被要求生成对应spec，无论这个节点时主agent执行还是子agent执行，都必须严格遵循并生成对应spec。

# 场景执行约束

- 匹配并加载 scene YAML 后、执行第一个 stage 前，必须先输出一个待办列表式执行清单，必须包含：状态 、流程阶段 、执行者 、产物 、使用资产 、说明。
- 如果 `afp_load_scene_template` 返回了 `executionPlanTable`，执行清单必须使用该表格，**严格禁止自行生成清单**。后续每个 stage 完成、跳过或失败时，在该表基础上更新 `状态`、`使用资产` 和 `说明`。
- 每完成一个场景节点后，必须回到执行清单，更新状态并显示输出最新的状态。
- 当用户执行apollo-flowpower的图片生码流程时，如果配置了子agent，那么严格禁止你去读取图片内容，你只需要识别图片路径，并把路径交给子agent，识别图片这一步交给后续流程节点的子agent去做。
- 当要求某个子agent使用某个skill进行任务时，交给子agent的任务信息中必须明确说明使用那个skill，不允许让子agent自己去推测。
- 当某个节点依赖用户提供的说明、文档、文件且由子agent执行时，你必须把需要的说明、文档、文件明确的交给子agent。
- 当用户配置了项目规范、组件文档等资产时，你必须在需要的节点中使用，如果你觉得委派给子agent的任务需要读取这些资产，务必把资产路径明确交给子agent。