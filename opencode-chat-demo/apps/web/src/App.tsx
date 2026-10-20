import { useEffect, useRef, useState, type FormEvent } from "react";

type Role = "user" | "assistant";

interface Message {
  id: string;
  role: Role;
  content: string;
}

interface ChatResponse {
  sessionId: string;
  message: string;
  created: boolean;
}

interface HealthResponse {
  ok: boolean;
  opencode: {
    ready: boolean;
    version?: string;
  };
}

let messageSequence = 0;

function makeId(): string {
  messageSequence += 1;
  return `${Date.now()}-${messageSequence}`;
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<HealthResponse>();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setHealth(undefined));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setError("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: makeId(), role: "user", content: text },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(sessionId ? { sessionId } : {}),
        }),
      });
      const data = (await response.json()) as ChatResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
      }

      setSessionId(data.sessionId);
      setMessages((current) => [
        ...current,
        { id: makeId(), role: "assistant", content: data.message },
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败");
    } finally {
      setSending(false);
    }
  }

  function startNewSession() {
    setSessionId(undefined);
    setMessages([]);
    setError("");
    setInput("");
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brandMark" aria-hidden="true">
            OC
          </span>
          <div>
            <h1>OpenCode Chat</h1>
            <p>Node proxy · session aware</p>
          </div>
        </div>
        <div className="serverState">
          <span
            className={`statusDot ${health?.opencode.ready ? "online" : ""}`}
          />
          {health?.opencode.ready
            ? `OpenCode ${health.opencode.version ?? "ready"}`
            : "正在连接"}
        </div>
      </header>

      <section className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="emptyState">
            <div className="orb">
              <span />
              <span />
              <span />
            </div>
            <p className="eyebrow">LOCAL AGENT GATEWAY</p>
            <h2>从一个新会话开始</h2>
            <p className="intro">
              第一条消息不携带 sessionId，Node 会自动创建 OpenCode
              会话；后续消息会沿用它的上下文。
            </p>
            <div className="suggestions">
              {[
                "用三点总结 TypeScript 的优势",
                "调用 concise-answer skill 简洁回答：什么是 SSE？",
                "调用 explain-code skill 解释 Promise.all",
              ].map((suggestion) => (
                <button key={suggestion} onClick={() => setInput(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="avatar">
                  {message.role === "user" ? "你" : "OC"}
                </div>
                <div className="bubble">
                  <span className="role">
                    {message.role === "user" ? "YOU" : "OPENCODE"}
                  </span>
                  <p>{message.content}</p>
                </div>
              </article>
            ))}
            {sending && (
              <article className="message assistant">
                <div className="avatar">OC</div>
                <div className="bubble thinking">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </section>

      <footer className="composerArea">
        {error && <div className="error">{error}</div>}
        <form className="composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="向 OpenCode 发送消息…"
            rows={1}
            disabled={sending}
          />
          <button
            className="send"
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="发送消息"
          >
            <span>↗</span>
          </button>
        </form>
        <div className="sessionBar">
          <span>
            SESSION
            <code>{sessionId ?? "发送首条消息后创建"}</code>
          </span>
          <button onClick={startNewSession} disabled={sending || !sessionId}>
            ＋ 新会话
          </button>
        </div>
      </footer>
    </main>
  );
}
