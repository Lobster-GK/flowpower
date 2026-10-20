# OpenCode Node + Web Chat Demo

一个完全独立的 Node 20+ / React 演示工程：

```text
浏览器 → Node API → OpenCode Server → 大模型
```

Node 启动时会自动在 `opencode-workspace/` 目录运行本项目安装的
`opencode serve`。该目录包含项目级 `opencode.json`、`AGENTS.md` 和两个示例
skills。

## 会话规则

`POST /api/chat` 接收：

```json
{
  "message": "你好",
  "sessionId": "可选"
}
```

- 没有 `sessionId`：Node 先调用 OpenCode `POST /session` 创建新会话。
- 有 `sessionId`：Node 直接复用该 OpenCode 会话。
- Node 再调用 `POST /session/:id/message`，等待模型完成。
- 每次响应都返回实际使用的 `sessionId`：

```json
{
  "sessionId": "ses_xxx",
  "message": "模型答复",
  "created": true
}
```

前端会保存响应中的 `sessionId` 并用于后续消息；点击“新会话”会清空它，因此下一条
消息会创建新的 OpenCode 会话。

## 环境要求

- Node.js 20 或更高版本
- npm
- 一个可用的 OpenCode 模型提供商

OpenCode 运行时目录会隔离到本 demo 的 `.runtime/`，不会读取或污染用户级
OpenCode 配置。Provider 认证请通过环境变量传入，例如 `ANTHROPIC_API_KEY` 或
`OPENAI_API_KEY`。密钥只由 OpenCode 子进程读取，不会发送给浏览器。

## 启动

```bash
cd opencode-chat-demo
npm install
npm run dev
```

然后访问 <http://localhost:5173>。

生产模式会先构建前后端，由 Node 同时提供 API 和前端静态文件：

```bash
npm start
```

然后访问 <http://localhost:3000>。

## 配置

复制 `.env.example` 为 `.env` 后可以调整：

- `PORT`：Node API 端口，默认 `3000`
- `OPENCODE_HOST` / `OPENCODE_PORT`：内部 OpenCode Server 地址
- `OPENCODE_WORKSPACE`：OpenCode 启动目录；默认 `./opencode-workspace`
- `OPENCODE_MODEL`：可选，格式为 `provider/model`
- `OPENCODE_AGENT`：可选，指定 OpenCode agent
- `OPENCODE_BIN`：可选，覆盖项目内置的 OpenCode 可执行文件路径

相对的 `OPENCODE_WORKSPACE` 会以 demo 根目录为基准解析。

如果你的 provider 需要 OAuth 登录，可先让它使用相同的隔离目录完成登录，或者把
所需认证改为环境变量。`.runtime/` 已加入 `.gitignore`。

## 目录

```text
opencode-chat-demo/
├─ apps/
│  ├─ server/                 # Express API + OpenCode 进程管理
│  └─ web/                    # React + Vite 对话页面
├─ opencode-workspace/
│  ├─ opencode.json           # 项目级 OpenCode 配置
│  ├─ AGENTS.md               # 对话规则
│  └─ .opencode/skills/
│     ├─ concise-answer/
│     └─ explain-code/
└─ package.json
```

## API

### `GET /api/health`

返回 Node 和 OpenCode Server 的状态、OpenCode 版本及工作目录。

### `POST /api/chat`

发送消息。请求必须包含非空 `message`，`sessionId` 可选。接口是同步等待式：模型
完成整条答复后返回 JSON。

OpenCode Server 只监听 `127.0.0.1`，并由 Node 在启动时生成随机 Basic Auth
密码；浏览器只能访问 Node API。
