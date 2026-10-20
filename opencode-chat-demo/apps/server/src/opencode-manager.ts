import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { config } from "./config.js";

type JsonObject = Record<string, unknown>;

interface OpenCodeSession {
  id: string;
}

interface OpenCodePart {
  type?: string;
  text?: string;
  synthetic?: boolean;
}

interface OpenCodeMessage {
  info?: JsonObject;
  parts?: OpenCodePart[];
}

export interface ChatResult {
  sessionId: string;
  message: string;
  created: boolean;
}

export class OpenCodeHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "OpenCodeHttpError";
  }
}

function resolveOpenCodeBinary(): string {
  const override = process.env.OPENCODE_BIN?.trim();
  if (override) return override;

  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve("opencode-ai/package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.opencode;

  if (!relativeBin) {
    throw new Error("无法从 opencode-ai 包中找到 opencode 可执行文件");
  }
  return path.resolve(path.dirname(packageJsonPath), relativeBin);
}

function parseModel(model: string | undefined):
  | { providerID: string; modelID: string }
  | undefined {
  if (!model) return undefined;

  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error("OPENCODE_MODEL 格式必须为 provider/model");
  }
  return {
    providerID: model.slice(0, separator),
    modelID: model.slice(separator + 1),
  };
}

export class OpenCodeManager {
  private process?: ChildProcess;
  private readonly password =
    process.env.OPENCODE_SERVER_PASSWORD?.trim() || randomBytes(24).toString("hex");
  private readonly username =
    process.env.OPENCODE_SERVER_USERNAME?.trim() || "opencode";
  private readonly baseUrl = `http://${config.opencodeHost}:${config.opencodePort}`;
  private readonly model = parseModel(config.opencodeModel);
  private lastStderr = "";
  private version?: string;

  async start(): Promise<void> {
    if (!fs.existsSync(config.opencodeWorkspace)) {
      throw new Error(`OpenCode 工作目录不存在：${config.opencodeWorkspace}`);
    }

    const runtimeConfig = path.join(config.opencodeRuntime, "config");
    const runtimeData = path.join(config.opencodeRuntime, "data");
    const runtimeCache = path.join(config.opencodeRuntime, "cache");
    for (const directory of [runtimeConfig, runtimeData, runtimeCache]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const executable = resolveOpenCodeBinary();
    console.log(`[opencode] 工作目录：${config.opencodeWorkspace}`);
    console.log(`[opencode] 正在启动：${this.baseUrl}`);

    const child = spawn(
      executable,
      [
        "serve",
        "--hostname",
        config.opencodeHost,
        "--port",
        String(config.opencodePort),
      ],
      {
        cwd: config.opencodeWorkspace,
        env: {
          ...process.env,
          OPENCODE_SERVER_PASSWORD: this.password,
          OPENCODE_SERVER_USERNAME: this.username,
          OPENCODE_CONFIG: path.join(config.opencodeWorkspace, "opencode.json"),
          OPENCODE_CONFIG_DIR: path.join(config.opencodeWorkspace, ".opencode"),
          XDG_CONFIG_HOME: runtimeConfig,
          XDG_DATA_HOME: runtimeData,
          XDG_CACHE_HOME: runtimeCache,
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.process = child;

    child.stdout.on("data", (chunk: Buffer) => {
      const output = chunk.toString().trim();
      if (output) console.log(`[opencode] ${output}`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const output = chunk.toString().trim();
      if (!output) return;
      this.lastStderr = `${this.lastStderr}\n${output}`.slice(-4_000);
      console.error(`[opencode] ${output}`);
    });
    child.on("error", (error) => {
      this.lastStderr = error.message;
      console.error("[opencode] 子进程错误", error);
    });

    const deadline = Date.now() + config.opencodeStartTimeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `OpenCode 启动失败，退出码 ${child.exitCode}。${this.lastStderr}`,
        );
      }

      try {
        const health = await this.request<{ healthy: boolean; version: string }>(
          "/global/health",
          { timeoutMs: 1_500 },
        );
        if (health.healthy) {
          this.version = health.version;
          console.log(`[opencode] 已就绪，版本 ${health.version}`);
          return;
        }
      } catch {
        // Server is still booting.
      }
      await delay(250);
    }

    this.stop();
    throw new Error(
      `等待 OpenCode 启动超时（${config.opencodeStartTimeoutMs}ms）。${this.lastStderr}`,
    );
  }

  stop(): void {
    if (this.process && this.process.exitCode === null) {
      this.process.kill("SIGTERM");
    }
    this.process = undefined;
  }

  getStatus(): {
    ready: boolean;
    version?: string;
    workspace: string;
    url: string;
  } {
    return {
      ready: Boolean(this.process && this.process.exitCode === null && this.version),
      version: this.version,
      workspace: config.opencodeWorkspace,
      url: this.baseUrl,
    };
  }

  async chat(message: string, suppliedSessionId?: string): Promise<ChatResult> {
    const created = !suppliedSessionId;
    const sessionId =
      suppliedSessionId || (await this.createSession(message)).id;

    const body: JsonObject = {
      parts: [{ type: "text", text: message }],
    };
    if (this.model) body.model = this.model;
    if (config.opencodeAgent) body.agent = config.opencodeAgent;

    const response = await this.request<OpenCodeMessage>(
      `/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        body,
        timeoutMs: config.opencodeRequestTimeoutMs,
      },
    );

    const answer = (response.parts ?? [])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();

    if (!answer) {
      throw new OpenCodeHttpError(
        "OpenCode 已返回结果，但其中没有文本答复",
        502,
        response,
      );
    }

    return { sessionId, message: answer, created };
  }

  private async createSession(firstMessage: string): Promise<OpenCodeSession> {
    const title =
      firstMessage.replace(/\s+/g, " ").trim().slice(0, 48) || "Web chat";
    const session = await this.request<OpenCodeSession>("/session", {
      method: "POST",
      body: { title },
    });

    if (!session.id) {
      throw new OpenCodeHttpError("OpenCode 创建会话后未返回 session id", 502, session);
    }
    return session;
  }

  private async request<T>(
    pathname: string,
    options: {
      method?: "GET" | "POST";
      body?: JsonObject;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          `${this.username}:${this.password}`,
        ).toString("base64")}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : undefined;
    } catch {
      payload = text;
    }

    if (!response.ok) {
      throw new OpenCodeHttpError(
        `OpenCode 请求失败：HTTP ${response.status}`,
        response.status,
        payload,
      );
    }
    return payload as T;
  }
}
