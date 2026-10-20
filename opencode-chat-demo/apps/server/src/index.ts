import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import fs from "node:fs";
import path from "node:path";

import { config } from "./config.js";
import { OpenCodeHttpError, OpenCodeManager } from "./opencode-manager.js";

interface ChatBody {
  message?: unknown;
  sessionId?: unknown;
}

const app = express();
const opencode = new OpenCodeManager();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    opencode: opencode.getStatus(),
  });
});

app.post(
  "/api/chat",
  async (
    request: Request<Record<string, never>, unknown, ChatBody>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const body = request.body ?? {};
      const message =
        typeof body.message === "string"
          ? body.message.trim()
          : "";
      const sessionId =
        typeof body.sessionId === "string"
          ? body.sessionId.trim()
          : "";

      if (!message) {
        response.status(400).json({ error: "message 不能为空" });
        return;
      }

      const result = await opencode.chat(message, sessionId || undefined);
      response.json(result);
    } catch (error) {
      next(error);
    }
  },
);

if (process.env.NODE_ENV === "test") {
  app.post("/api/test/shutdown", (_request, response) => {
    response.json({ ok: true });
    setImmediate(() => shutdown("smoke-test"));
  });
}

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.use((request, response, next) => {
    if (request.method !== "GET" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(config.webDist, "index.html"));
  });
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("[api]", error);

  if (
    error instanceof SyntaxError &&
    "status" in error &&
    error.status === 400
  ) {
    response.status(400).json({ error: "请求体不是有效的 JSON" });
    return;
  }

  if (error instanceof OpenCodeHttpError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    response.status(status).json({
      error: error.message,
      details: error.details,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "未知服务端错误";
  response.status(500).json({ error: message });
};
app.use(errorHandler);

await opencode.start();

const server = app.listen(config.apiPort, () => {
  console.log(`[api] http://localhost:${config.apiPort}`);
});

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  console.log(`[api] 收到 ${signal}，正在关闭`);
  server.close(() => {
    opencode.stop();
    process.exit(0);
  });
  setTimeout(() => {
    opencode.stop();
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
