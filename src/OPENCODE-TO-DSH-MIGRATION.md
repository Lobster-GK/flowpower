# Apollo Flowpower：从 OpenCode 到 DeepSeek Harness 的适配说明

本文说明当前仓库的实际迁移方案、已经完成的改动，以及插件 API、配置钩子、命令、技能和子代理的转换方式。记录日期：2026-09-17。

这里的“迁移”是为同一个 npm 包增加 DSH 入口。原 OpenCode 入口继续保留，两种宿主共用业务逻辑和项目数据。

## 1. 迁移思路：业务逻辑共享，宿主接口分别实现

原插件包含两类代码：

- **业务逻辑**：读取项目配置、迁移配置、发现和解析 scene YAML、生成执行计划、诊断项目，以及 commands、skills、agents 的提示词。
- **宿主接入逻辑**：注册工具、提供技能、注册命令、配置子代理，以及取得工作区和会话上下文。

第一类不需要因为换宿主重写。第二类必须使用目标宿主的 API，不能简单替换 import 包名。

当前结构如下：

```text
同一个 npm 包 apollo-flowpower
│
├─ OpenCode 入口：src/index.ts → dist/index.js
│  └─ Plugin 函数返回 tool 和 config 钩子
│
├─ DSH 入口：src/dsh.ts → dist/dsh.js
│  ├─ Cordis name / inject / apply
│  ├─ dsh-resources.ts：技能 provider、斜杠命令、会话工作区
│  └─ dsh-agents.ts：子代理调用、权限、路由、附件、取消和清理
│
└─ 共享实现
   ├─ core-tools.ts：工具描述、业务分发、项目初始化
   ├─ scenes.ts / project-config.ts / doctor.ts
   ├─ agent-presets.ts / agents/*.md
   └─ commands/ / skills/ / scene-template/
```

这里共用的主要契约是工具输出中的业务 JSON，而不是要求两个宿主的工具 UI 和返回包装完全相同。

## 2. 具体改了哪些文件

以下路径均相对于仓库根目录。

| 文件 | 改动及用途 |
|---|---|
| `src/core-tools.ts` | 新增共享初始化函数、四个工具的描述和业务分发，减少两个入口各自维护逻辑的风险 |
| `src/index.ts` | 原 OpenCode 入口改为调用共享实现，保留资源同步及配置钩子 |
| `src/dsh.ts` | 新增 Cordis 插件入口，注册四个业务工具、技能、命令及委派工具 |
| `src/dsh-resources.ts` | 新增 DSH 工作区解析、技能 provider、命令处理及宿主说明文本 |
| `src/dsh-agents.ts` | 新增六个角色到 DSH 子代理服务的适配 |
| `src/cordis.patch.yml` | 声明 DSH 应加载的插件模块及默认配置 |
| `package.json` | 增加 `./dsh` 导出、bundle 声明、DSH SDK 依赖及测试命令 |
| `tsconfig.json` | 开启 declaration，生成入口对应的 `.d.ts` 文件 |
| `src/tests/dsh.test.mjs` | 覆盖工具一致性、注册、命令、技能、权限、附件、并行和异常处理 |
| `src/tests/runtime.test.mjs` | 使用真实 Harness Agent Loop 和 spawn provider 做集成验证 |
| `src/DSH.md`、`src/DSH-NPM-GUIDE.md`、`README.md` | 补充 DSH 接入、配置和 npm 安装使用说明 |

## 3. 插件入口是如何转换的

### OpenCode：执行插件函数，取得钩子对象

原入口的核心形式是：

```ts
export const ApolloFlowpower: Plugin = async (ctx) => {
  initializeProject(ctx.directory);
  return {
    tool: { /* 四个业务工具 */ },
    config: async (config) => {
      // 增加 skills 路径，补齐默认 agent 配置
    },
  };
};
```

OpenCode 调用插件函数，插件返回由宿主识别的工具与配置钩子。

### DSH：声明服务依赖，在 apply 中注册能力

新增入口的核心形式是：

```ts
export const name = "apollo-flowpower";
export const inject = ["tools", "skills", "commands", "subagents", "llm"];

export function apply(ctx: Context, config: Config = {}): void {
  validateConfig(config);
  // ctx.tools.register(...) 注册四个业务工具
  registerSkills(ctx);
  registerCommands(ctx);
  registerSubagents(ctx, config);
}

export default { name, inject, apply };
```

`inject` 声明插件需要的宿主服务；`apply` 在这些服务可用时注册能力。DSH 的 `ctx` 是 Cordis 服务上下文，不能当作 OpenCode 的 `ctx` 使用。

### DSH 如何找到这个入口

入口发现链路为：

```text
package.json 的 dsh.bundle.patch
  → src/cordis.patch.yml
  → name: apollo-flowpower/dsh
  → package.json 的 exports["./dsh"]
  → dist/dsh.js
  → Cordis 加载 name / inject / apply
```

实际 bundle patch：

```yaml
- insert:
    - id: apollo-flowpower
      name: apollo-flowpower/dsh
      config:
        subagentProvider: spawn
```

`id` 是配置行的标识，`name` 才是需要解析的模块名。若发布成 `@team/flowpower`，应把 `name` 改为 `@team/flowpower/dsh`；仅修改 npm 包名不足以完成入口迁移。

## 4. 原来的 API 和钩子如何对应

原插件实际使用的是 `tool` 和 `config`，没有实现聊天消息、模型调用前后或工具调用前后的事件钩子。因此本次没有虚构一组事件钩子来做对应转换。

| 原 OpenCode 接口或行为 | 当前 DSH 实现 | 转换含义 |
|---|---|---|
| 插件函数 `Plugin(ctx)` | Cordis `apply(ctx, config)` | 从返回钩子对象改成向服务注册能力 |
| 返回对象中的 `tool` | `ctx.tools.register(defineTool(...))` | 每个工具独立注册 |
| `tool.schema` 参数定义 | `ParameterSchemaSpec` | 重写宿主参数描述，保留业务参数意义 |
| 工具的 `context.directory` | `exec.agent.session.header.cwd` | 从实际调用会话获得工作区 |
| `config` 中追加 `skills.paths` | `ctx.skills.registerProvider(...)` | 从添加扫描目录改成提供技能候选和正文 |
| `config` 中补齐 `config.agent` | `afp_run_subagent` + `ctx.subagents.start(...)` | 从宿主静态角色配置改成按次构造委派参数 |
| Markdown 命令资源 | `ctx.commands.register(...)` | 显式注册命令并将正文和用户输入交给会话 |
| 可选同步 commands/skills | DSH 直接读取包资源及旧目录覆盖 | DSH 不执行原 OpenCode 资源复制开关 |
| 插件加载时初始化项目 | 命令执行或相关业务工具访问时初始化 | 避免全局插件加载时选错会话工作区 |

**不是把 OpenCode 的 `config` 钩子重命名成 DSH 的 `config`。** DSH `apply` 的第二个参数是插件自己的配置，例如 `modelRoutes`；原 OpenCode 钩子修改的是宿主配置。二者职责不同。

## 5. 四个业务工具如何保持一致

共享工具为：

| 工具 | 业务职责 |
|---|---|
| `afp_list_scenes` | 列出项目可用场景 |
| `afp_load_scene_template` | 根据 `scene` 加载场景及执行计划 |
| `afp_get_project_config` | 返回经过校验的项目资产和子代理模型配置 |
| `afp_doctor` | 检查配置、模板、资产和引用等问题 |

两种入口都调用 `executeAfpTool(name, directory, scene?)`。

OpenCode 保留原包装：

```ts
{ title, output: JSON.stringify(businessResult), metadata }
```

DSH 的执行函数解析其中的 `output`，返回结构化值；工具的 `output.render` 再将它渲染为文本内容块：

```ts
const result = executeAfpTool(name, projectDirectory(exec.agent), scene);
return JSON.parse(result.output);
```

因此业务 JSON 一致，OpenCode 的 `title/metadata` 不会作为同名 UI 字段直接搬到 DSH。DSH 用 `presentCall` 提供调用卡片标题。

`afp_load_scene_template` 仍要求字符串 `scene`。其他工具保留宽松的可选参数，容忍模型误传说明性字段；这些字段不参与业务计算。

执行前检查 `exec.signal`。由于工具访问可能补齐配置或模板，没有把这些工具声明为并发安全。同步文件操作开始后，并不意味着可以在任意中间步骤被取消。

## 6. 技能与命令如何转换

### 技能：从目录配置到 provider

`registerSkills` 注册名为 `apollo-flowpower` 的 provider：

1. `list` 扫描技能文件并读取 frontmatter，产生技能候选。
2. `get` 在使用时重新读取正文。
3. 保留 `name`、`description` 及调用限制。
4. 设置 `resourceBase` 为技能文件目录，让相对的 scripts、references、assets 有明确基准。
5. 在正文后附加 `DSH_GUIDANCE`，解释 DSH 的委派工具和宿主差异。

候选来源包括包内 `skills/` 和项目 `.opencode/skills/`。旧项目副本 rank 为 250，包内资源为 600；旧副本优先于包内默认值，并让位于 Harness 原生项目技能来源。正文每次加载重读，但新增、删除或重命名旧目录技能可能需要重启 Harness 才能刷新目录缓存。

### 命令：显式注册，并保留消息来源

DSH 为包内 11 个 `/afp-*` 命令注册 handler。调用时：

```text
获取当前会话 cwd
  → 初始化缺失的项目配置和模板
  → 优先读取 .opencode/commands 下的同名文件，否则读取包内命令
  → agent.inject：命令说明 + DSH_GUIDANCE，标记为 plugin 来源
  → agent.steer：附件 + 原命令和 rawInput，标记为 user 来源
```

这样做既保留用户参数和附件，也避免把插件提供的说明伪装成用户亲自输入的内容。

handler 返回“已提交”只代表输入已经交给会话，不代表整个场景已经执行完成。注册范围是包内对应的 11 个命令；并未实现扫描任意新增的 OpenCode 自定义命令。

## 7. 子代理是适配工作中变化最大的部分

### 为什么新增 `afp_run_subagent`

OpenCode 原实现向 `config.agent` 补齐六个默认角色，已有同名角色则完整保留。DSH 适配器没有直接读取这份 OpenCode agent 配置，而是新增一个模型可调用的委派工具：

```json
{
  "agent": "afp-observer-agent",
  "prompt": "完整阶段任务、必要事实和输出要求",
  "skills": ["阶段需要的技能名"],
  "count": 3
}
```

六个角色仍为 context、observer、planner、builder、verifier、review 对应的 `afp-xxx-agent`，共用原 `agent-presets.ts` 与包内角色提示词。

| 原角色配置 | DSH 委派参数 |
|---|---|
| 角色 prompt | `persona` |
| `tools` 能力开关 | `toolFilter.allow` |
| 角色模型字符串 | `agentOptions.provider/model`，通过显式映射取得 |
| 子代理身份 | `ctx.subagents.start` 创建的运行实例及 label |
| 阶段技能 | 按顺序 `ctx.skills.get`，经 `renderSkillContent` 加入任务 |

实际启动调用使用 `parent`、`signal`、`persona`、`toolFilter`、`maxDepth: 3`、可选 `agentOptions` 及包含附件的 `prompt`。

### 权限映射

`read/write/edit` 映射为同名工具；shell 能力优先映射为已注册的 `pwsh`，否则使用 `bash`。另外按实际可用性补充 `skill`、配置查询，以及读权限相关的搜索和图片读取工具。

必要工具缺失时明确报错，不自动放开所有工具。没有用 `str_replace_editor` 代替独立读写编辑工具，因为这样无法保留原有权限划分。shell 本身可能写文件，因此文件工具白名单不能理解为操作系统级只读隔离。

### 模型路由

AFP 项目配置中的模型字符串采用精确映射，不根据 `/` 猜测 provider 和模型名：

```yaml
# DSH profile 的 cordis.patch.yml：修改已经由 bundle 插入的行
- id: apollo-flowpower
  config:
    subagentProvider: spawn
    modelRoutes:
      my-vision-model:
        provider: your-provider
        model: your-model-id
```

项目 `config.yaml` 中角色的 `model: my-vision-model` 对应上述映射。模型为空时交由 provider 继承父会话有效路由；非空且缺少映射时失败。

`subagentProvider` 是子代理执行后端，默认 `spawn`，不是模型服务商名称。调用前会检查后端是否支持 persona、toolFilter、depthLimit，以及必要时的 agentOptions。

### 自定义角色

DSH 的 `config.agents.<角色名>` 支持 `persona`、`toolFilter` 和可选 `agentOptions`。同名覆盖完整替代默认角色；不会再混入项目配置中的默认角色模型。

这保留了“用户角色优先”的设计意图，但不是自动迁移：用户原来写在 OpenCode `config.agent` 中的自定义角色，需要显式转换到 DSH 配置。

### 并行、附件和失败清理

- `count` 范围为 1～5；一次调用提交所有子任务，不等待第一个结果后再启动第二个。
- 每个子代理收到相同完整阶段任务和技能，不把一个任务拆分给多个职责。
- 从 `deriveMessages()` 的可见用户消息获取附件：优先取最近一次 `/afp-*` 命令以来的附件，否则从最近带附件的用户消息开始获取。
- 不从原始事件恢复已经被压缩隐藏的附件；图片委派前检查有效模型路由声明了 image 输入能力。
- 使用共享取消信号；任一任务失败则中止其他任务，通过 `Promise.allSettled` 等待收尾。
- 每个已创建的运行实例都执行 `dispose()`；启动、执行或清理失败都不能作为完整成功返回。
- 成功时返回各子代理完整的 `results`，供主模型持久化与合并。

代码保证提交方式和等待、清理策略。实际并发容量仍取决于 provider；提示词要求各子代理只写自己的目录，但这里没有实现文件系统级的目录沙箱。

## 8. 哪些规则仍然由模型执行

原插件是提示词驱动的场景编排，本次没有新增一个程序化场景状态机。

`afp_run_subagent` 只负责一次阶段委派，不负责遍历完整 scene。以下行为仍由主模型依据 scene、command、skill 和 `DSH_GUIDANCE` 执行：

- 选择场景、按阶段顺序推进。
- 每阶段重新读取配置并选择所需资产。
- 按 `onFail/maxRetries` 决定重试或终止。
- 持久化子结果，合并生成 canonical final，更新阶段状态。
- 普通聊天不主动进入 AFP 编排。

这些规则写入提示词并尽可能保留原语义，但不能将它们描述为全部由 TypeScript 强制保证。工具报错能阻止该次调用成功，不能自动证明模型后续状态记录一定正确。

## 9. 数据与生命周期的处理

数据继续使用项目 `.opencode/apollo-flowpower`，不另建一份 `.dsh/apollo-flowpower`。初始化补齐缺失文件，必要时执行已有配置迁移逻辑；不会用包内模板整体覆盖用户内容。

DSH 插件可能服务多个工作区，因此从调用 agent 的 `session.header.cwd` 获取绝对本地目录。没有回退到进程的 `process.cwd()`，避免把 A 会话的数据写入 B 项目。

当前仍使用 Node 本地文件系统 API，未迁移到远程文件系统抽象。远程或与宿主隔离的工作区不在当前适配范围内。

工具、技能和命令通过 Cordis 上下文注册，注册与卸载行为已测试；子代理运行实例则由适配器显式清理。DSH 不读取旧 `.opencode/config.json` 的 `syncBuiltinResources` 来复制资源。

## 10. 已完成的验证与版本边界

初始实现使用 DSH SDK `0.1.5-rc.2` 和 Cordis `4.0.2` 编译。测试共 15 项，覆盖共享 JSON 一致性、四个业务工具、11 个命令、项目隔离、资源覆盖、权限、路由、附件、并行、取消和异常清理。

集成测试使用真实 Cordis、Agent Loop 和 spawn provider，模型由不联网的 fixture 提供响应，验证了三个子代理重叠执行及最终清理。另做过 npm tarball 安装和双入口导入检查。

随后在独立临时副本中把全部 Harness 依赖固定为 `0.1.5-rc.1`，编译及 15 项测试也全部通过。因此当前调用的接口在这组 rc.1 测试环境下可用。

但仓库当前 `peerDependencies` 仍精确声明 rc.2，尚未改成同时接受 rc.1 和 rc.2。**测试通过不等于已发布 npm 包的依赖声明也支持 rc.1。** 正式支持两个版本应调整声明、重新构建并发布新版本。

尚未完成真实模型 API、Web UI 和完整场景产物质量的端到端验收；不能据此承诺不同宿主和模型会生成逐字相同的结果。

安装时遇到的 `ERR_PNPM_IGNORED_BUILDS`、例如 `msgpackr-extract@3.0.4`，属于依赖构建脚本审批问题，应与 SDK peer 版本问题分别排查。它不是修改插件业务 API 的依据。

## 11. 后续维护时如何选择修改位置

| 需求 | 优先修改位置 |
|---|---|
| 调整场景解析、项目配置、诊断规则 | 共享业务模块，并验证两个入口 |
| 调整通用角色职责或能力开关 | `agent-presets.ts` 和 `agents/` |
| 调整通用流程说明 | `commands/`、`skills/`、`scene-template/` |
| 适配新的 DSH 工具协议 | `dsh.ts` |
| 调整 DSH 技能发现、命令消息处理 | `dsh-resources.ts` |
| 调整 DSH 子代理后端、权限、路由、附件 | `dsh-agents.ts` |
| 修改 npm 包名或入口路径 | 同步检查 `exports` 与 `cordis.patch.yml` 的 `name` |
| 声明新的 SDK 兼容范围 | 先做隔离版本验证，再调整 package 元数据 |

这样维护时，业务规则仍只有一份；宿主 API 的差异集中在入口和适配文件中。
