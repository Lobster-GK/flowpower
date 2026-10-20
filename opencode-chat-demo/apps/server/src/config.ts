import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const demoRoot = path.resolve(serverRoot, "../..");
dotenv.config({ path: path.join(demoRoot, ".env") });

function integerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} 必须是 1-65535 之间的整数`);
  }
  return value;
}

function durationFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

const configuredWorkspace = process.env.OPENCODE_WORKSPACE?.trim();

export const config = {
  apiPort: integerFromEnv("PORT", 3000),
  opencodeHost: process.env.OPENCODE_HOST?.trim() || "127.0.0.1",
  opencodePort: integerFromEnv("OPENCODE_PORT", 4096),
  opencodeStartTimeoutMs: durationFromEnv("OPENCODE_START_TIMEOUT_MS", 30_000),
  opencodeRequestTimeoutMs: durationFromEnv("OPENCODE_REQUEST_TIMEOUT_MS", 600_000),
  opencodeWorkspace: configuredWorkspace
    ? path.resolve(demoRoot, configuredWorkspace)
    : path.join(demoRoot, "opencode-workspace"),
  opencodeRuntime: path.join(demoRoot, ".runtime"),
  opencodeModel: process.env.OPENCODE_MODEL?.trim() || undefined,
  opencodeAgent: process.env.OPENCODE_AGENT?.trim() || undefined,
  webDist: path.join(demoRoot, "apps", "web", "dist"),
};
