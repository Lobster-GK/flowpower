import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

test("only creates an OpenCode session when sessionId is missing", async (context) => {
  const calls = [];
  const fakeOpenCode = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      calls.push({
        method: request.method,
        path: request.url,
        body: body ? JSON.parse(body) : undefined,
      });

      response.setHeader("Content-Type", "application/json");
      if (request.method === "POST" && request.url === "/session") {
        response.end(JSON.stringify({ id: "ses_created" }));
        return;
      }
      if (
        request.method === "POST" &&
        request.url?.startsWith("/session/") &&
        request.url.endsWith("/message")
      ) {
        response.end(
          JSON.stringify({
            info: { role: "assistant" },
            parts: [{ type: "text", text: "fake model answer" }],
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
  });

  await new Promise((resolve) => fakeOpenCode.listen(0, "127.0.0.1", resolve));
  context.after(
    () => new Promise((resolve) => fakeOpenCode.close(() => resolve())),
  );

  const address = fakeOpenCode.address();
  assert(address && typeof address === "object");
  process.env.OPENCODE_HOST = "127.0.0.1";
  process.env.OPENCODE_PORT = String(address.port);
  delete process.env.OPENCODE_MODEL;
  delete process.env.OPENCODE_AGENT;

  const { OpenCodeManager } = await import(
    `../dist/opencode-manager.js?test=${Date.now()}`
  );
  const manager = new OpenCodeManager();

  const first = await manager.chat("first message");
  assert.deepEqual(first, {
    sessionId: "ses_created",
    message: "fake model answer",
    created: true,
  });

  const continued = await manager.chat("follow up", "ses_existing");
  assert.deepEqual(continued, {
    sessionId: "ses_existing",
    message: "fake model answer",
    created: false,
  });

  assert.equal(
    calls.filter((call) => call.path === "/session").length,
    1,
    "POST /session should only be called for the request without sessionId",
  );
  assert.equal(calls[1].path, "/session/ses_created/message");
  assert.equal(calls[2].path, "/session/ses_existing/message");
});
