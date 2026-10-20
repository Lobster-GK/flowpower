# Apollo Flowpower on DeepSeek Harness

本适配器按 `@deepseek-ai/dsh-* 0.1.5-rc.2`、Cordis `4.0.2` 编译和验证。
OpenCode 原入口保持为 `apollo-flowpower`；Harness 使用 `apollo-flowpower/dsh`。
这是本地工作区适配器：AFP YAML 和资源仍通过 Node 本地文件系统读取，不能直接用于远程文件系统或与宿主隔离的工作区。

## 安装

在本插件包根目录运行：

```powershell
npm install
npm run build
dsh plugin --profile web add .
dsh --profile web --dump-config
dsh web
```

`dsh`、`pnpm` 需已安装。使用与上述 SDK 版本匹配的 Harness 环境。
建议使用 Node 24.x（至少 24.15）；本次独立安装中传递依赖 `ini@7` 对 Node 22.19 给出了 engine 警告。
package.json 的 `dsh.bundle.patch` 会让安装命令自动激活 AFP，dump-config 中应出现
`id: apollo-flowpower`、`name: apollo-flowpower/dsh`。
若要测试打包后的安装，可执行 `npm pack`，再 `dsh plugin --profile web add <生成的 tgz>`。

依赖 base-backed profile 已提供的 `tools`、`skills`、`commands`、`subagents`、`llm` 服务；
还需启用 `dsh-tool-skill`、`dsh-subagent-spawn-in-process` 和独立 `read/write/edit` 文件工具。
需要 shell 的角色使用已注册的 `pwsh`（优先）或 `bash`。只提供 `str_replace_editor` 的最小 profile
不能表达现有角色的独立读/写/编辑权限；应加载 `dsh-tool-fs`，否则委派会明确失败。
`sdk-minimal` 不包含这些能力，不能仅添加 AFP 就获得完整流程。

## 使用与数据兼容

原有 11 个 `/afp-*` 命令全部注册，`/afp-scene scene=text-to-page <任务>` 启动完整流程。
命令保留原 Markdown 正文、参数、图片和文件附件；单能力命令不自动串联流程。
项目 `.opencode/commands/afp-*.md` 的同名用户修改优先于包内对应命令，每次调用重读。
完整编排仍由模型遵守原 scene/command 规则执行，不新增另一套状态机。

四个工具的结构化 JSON 与 OpenCode 共用一份实现：
`afp_list_scenes`、`afp_load_scene_template`、`afp_get_project_config`、`afp_doctor`。
数据继续位于项目 `.opencode/apollo-flowpower`，不会生成第二份 `.dsh/apollo-flowpower`。
首次命令/工具访问补齐缺失配置和模板，已有用户内容不覆盖。

包内 skills 通过 Harness provider 提供，按需加载正文并保留 scripts/references/assets 的目录基准。
Harness 自己的项目/用户 skill 优先于 AFP 内置默认值。
AFP 也发现旧 `.opencode/skills` 自定义副本，优先于内置资源，低于 Harness 的 `.dsh/skills` 和 `.agents/skills`。
旧目录 skill 正文每次加载都会重读；增加/删除/重命名 skill 后重启会话所在 Harness，或使用原生 `.dsh/skills` 的文件监控。
Harness 不读取旧 `.opencode/config.json` 的 `syncBuiltinResources`，不向 OpenCode 目录同步 commands/skills。

## 子 agent 与模型

DSH 增加 `afp_run_subagent`，把六个角色映射到 provider 的 persona、toolFilter 和模型路由。
单 agent 用 count=1；同职责独立并行节点用一次调用传 count=2..5。
适配器提交所有启动请求后再等待结果，并将完整 results 按编号返回主模型。
后台并发容量仍由所选 Harness provider 决定；应使用有足够容量的 spawn provider。
同一次委派的每个子 agent 接收相同完整任务、按顺序加载的 skills、当前 AFP 命令以来的可见用户附件。
非 AFP 命令上下文中默认传递最近一次带附件的用户输入；被压缩移除的附件需重新提供。
主模型按 scene 的 persistOutputs/outputDir 持久化子结果并合并 canonical final。
失败会中止兄弟任务并等待清理；不会把部分完成当成功，取消信号会传递到每个子 agent。

AFP config 的模型字符串不能假设与 Harness provider/model 路由相同。
在 profile 的用户 `cordis.patch.yml` 中配置精确映射；不配置模型则继承父会话路由：

```yaml
- id: apollo-flowpower
  config:
    subagentProvider: spawn
    modelRoutes:
      my-vision-model:
        provider: your-provider
        model: your-image-capable-model
```

项目 config 中 `subagents.afp-observer-agent.model: my-vision-model` 会使用上述路由。
缺少映射时明确报错，不猜测斜线格式、不静默换模型。传递图片前核对有效路由的 image 输入能力；
未声明支持图片的模型会在创建子 agent 前报错，不把图片降为文字摘要。
自定义完整角色可在同一 config 下使用 `agents.<afp-xxx-agent>`：

```yaml
    agents:
      afp-review-agent:
        persona: "项目专属审查规则"
        toolFilter:
          allow: [read, grep, glob, skill, afp_get_project_config]
        agentOptions:
          provider: your-provider
          model: your-model
```

同名覆盖完整替代默认角色，包括权限和模型；其 agentOptions 缺省时继承父模型，
不会再合并 AFP project config 的默认模型。OpenCode `config.agent` 中的自定义角色需要显式迁移到这里。
默认只允许角色声明的读/写/编辑/shell 以及可见的 skill、配置查询和只读搜索工具，
不继承未映射的新工具。shell 仍有其自身文件写入能力，与原 preset 的 bash=true 行为一致。

## 验证

```powershell
npm run typecheck
npm test
```

自动测试使用真实 Harness 工具/skill 注册和参数校验，并以可控子 agent 后端验证并行、附件、权限、取消及失败清理。
集成测试还启动真实 Agent Loop 与 spawn provider，通过无网络的模型 fixture 检查三个子会话并发、角色提示词和权限过滤。
不需要 API key。真实模型的 UI 观察、生码质量及完整场景执行仍需在目标 profile 中验收。

接口来源：
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/tools.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/commands.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/subagent.md
- https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md