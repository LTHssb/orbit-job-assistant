"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "../../lib/supabase/browser";
import { DEMO_MODE, getSupabasePublicConfig } from "../../lib/supabase/env";

function getFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("invalid login credentials")) return "邮箱或密码不正确，请检查后重试。";
  if (message.includes("email not confirmed")) return "请先完成邮箱确认，再登录。";
  if (message.includes("user already registered")) return "这个邮箱已经注册过了，请直接登录。";
  if (message.includes("password")) return "密码不符合要求，请使用至少 6 位字符。";
  return "账户服务暂时不可用，请稍后重试。";
}

function getCallbackError(value: string | null) {
  switch (value) {
    case "missing_code":
      return "登录链接缺少授权信息，请重新发起登录。";
    case "exchange_failed":
      return "登录链接已失效或已使用，请返回登录页重新操作。";
    case "service_unavailable":
      return "账户服务尚未配置，请联系站点管理员。";
    default:
      return "";
  }
}

export function AuthForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const configured = Boolean(getSupabasePublicConfig());

  useEffect(() => {
    const callbackError = getCallbackError(new URLSearchParams(window.location.search).get("error"));
    if (callbackError) setMessage(callbackError);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setMessage("账户服务尚未连接，请先配置 Supabase 环境变量。");
        return;
      }

      const result = mode === "sign-in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });

      if (result.error) {
        setMessage(getFriendlyError(result.error));
        return;
      }

      setMessage(mode === "sign-in" ? "登录成功，正在进入账户页…" : "注册成功，请检查邮箱完成确认。 ");
      if (mode === "sign-in") window.location.assign("/account");
    } catch (error) {
      setMessage(getFriendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>邮箱<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label>密码<input type="password" required minLength={6} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位字符" /></label>
      <button className="hero-cta auth-submit" type="submit" disabled={busy || !configured}>{busy ? "处理中…" : mode === "sign-in" ? "登录 ORBIT" : "创建账户"}</button>
      {!configured && <p className="auth-message">{DEMO_MODE ? "作品集演示模式已启用；配置 Supabase 后可切换真实登录。" : "真实登录尚未配置，请设置 Supabase 环境变量后再使用账户功能。"}</p>}
      {message && <p className="auth-message">{message}</p>}
      <button className="auth-switch" type="button" onClick={() => { setMode(mode === "sign-in" ? "sign-up" : "sign-in"); setMessage(""); }}>
        {mode === "sign-in" ? "还没有账户？创建一个" : "已有账户？返回登录"}
      </button>
    </form>
  );
}
