import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import type { AuthSession } from "../../../types";

const apiBaseUrl = getApiBaseUrl();

type AuthMode = "login" | "register";

export function LoginView({ onAuthenticated }: { onAuthenticated: (session: AuthSession) => void }) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function submitAuth() {
    setLoading(true);
    setMessage("");

    try {
      if (mode === "login") {
        const session = await postJson<AuthSession>("/api/auth/login", { email, password });
        onAuthenticated(session);
        return;
      }

      const registerResult = await postJson<{ user?: AuthSession["user"]; joinRequest?: unknown }>("/api/auth/register", {
        email,
        password,
        name,
        groupName: groupName || undefined,
        groupId: groupId || undefined,
      });

      if (registerResult.user?.pending) {
        setMessage("参加申請を送信しました。Adminの承認後にログインできます。");
        setMode("login");
        return;
      }

      const session = await postJson<AuthSession>("/api/auth/login", { email, password });
      onAuthenticated(session);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <div className="login-header">
          <h1>{mode === "login" ? "ログイン" : "登録"}</h1>
          <div className="segmented-control" aria-label="ログインと登録の切替">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>ログイン</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>登録</button>
          </div>
        </div>
        <label className="field">
          <span>メールアドレス</span>
          <input value={email} autoComplete="email" onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="field">
          <span>パスワード</span>
          <input value={password} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {mode === "register" && (
          <>
            <label className="field">
              <span>名前</span>
              <input value={name} autoComplete="name" onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>グループ名</span>
              <input value={groupName} placeholder="新規グループを作る場合" onChange={(event) => setGroupName(event.target.value)} />
            </label>
            <label className="field">
              <span>グループID</span>
              <input value={groupId} placeholder="既存グループへ参加申請する場合" onChange={(event) => setGroupId(event.target.value)} />
            </label>
          </>
        )}
        {message && <p className="login-message">{message}</p>}
        <button className="primary-button full-width-button" disabled={loading} onClick={submitAuth}>
          {mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
          {loading ? "送信中" : mode === "login" ? "ログイン" : "登録"}
        </button>
      </section>
    </main>
  );
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`APIに接続できません: ${apiBaseUrl}`);
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error ?? "API error");
  }

  return payload as T;
}

function getApiBaseUrl() {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  if (viteEnv?.VITE_API_BASE_URL) return viteEnv.VITE_API_BASE_URL;

  return `http://${window.location.hostname}:8787`;
}
