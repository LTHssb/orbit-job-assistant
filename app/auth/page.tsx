import Link from "next/link";
import { AuthForm } from "./auth-form";

export const dynamic = "force-dynamic";

export default function AuthPage() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link className="auth-back" href="/">← 返回 ORBIT</Link>
        <p className="eyebrow">ORBIT · PERSONAL WORKSPACE</p>
        <h1>把你的求职进度，收进一条航线。</h1>
        <p className="auth-intro">登录后可以保存岗位、跟踪投递，并把面试安排进你的求职工作区。</p>
        <AuthForm />
      </section>
    </main>
  );
}
