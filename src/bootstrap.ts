import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packageRoot } from "./config.js";

const BOOTSTRAP_MARKER = "Apollo-flowpower";

let cachedBootstrap: string;

function readRule(): string {
  const file = join(packageRoot(), "src", "rule.md");
  if (!existsSync(file)) return '';

  const content = readFileSync(file, "utf8").trim();
  if (!content) return '';

  return [BOOTSTRAP_MARKER, "", content].join("\n");
}

/**
 * 生成注入到第一条用户消息里的 bootstrap prompt。
 *
 * 注入内容来自 `src/rule.md`，不再内联拼接，也不再读取
 * `codegen-superpower-workflow` skill。这样规则文本可以独立维护。
 */
export function buildBootstrapPrompt(): string {
  if (cachedBootstrap !== undefined) return cachedBootstrap;
  cachedBootstrap = readRule();
  return cachedBootstrap;
}

function isUserMessage(message: Record<string, unknown>): boolean {
  const info = message.info;
  return message.role === "user" || (Boolean(info) && typeof info === "object" && (info as Record<string, unknown>).role === "user");
}

function hasBootstrap(messages: Array<Record<string, unknown>>): boolean {
  return messages.some((message) => JSON.stringify(message).includes(BOOTSTRAP_MARKER));
}

/**
 * 把 bootstrap 注入到第一条 user 消息。
 *
 * OpenCode 当前消息结构通常是 `{ info: { role }, parts: [...] }`；
 * 这里优先向 `parts` 前面插入 text part，同时兼容旧的 `role/content` 结构。
 */
export function injectBootstrap(messages: Array<Record<string, unknown>>): void {
  if (hasBootstrap(messages)) return;

  const bootstrap = buildBootstrapPrompt();
  if (!bootstrap) return;

  const firstUser = messages.find(isUserMessage);
  if (!firstUser) return;

  const parts = firstUser.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const ref = parts[0];
    if (Boolean(ref) && typeof ref === "object") {
      parts.unshift({ ...(ref as Record<string, unknown>), type: "text", text: bootstrap });
    } else {
      parts.unshift({ type: "text", text: bootstrap });
    }
    return;
  }

  const content = firstUser.content;
  if (typeof content === "string") {
    firstUser.content = `${bootstrap}\n\n${content}`;
    return;
  }
  if (Array.isArray(content)) {
    firstUser.content = [{ type: "text", text: bootstrap }, ...content];
    return;
  }

  firstUser.parts = [{ type: "text", text: bootstrap }];
}

