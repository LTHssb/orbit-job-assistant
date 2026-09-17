import Link from "next/link";
import { DEMO_MODE } from "../lib/supabase/env";
import { createSupabaseAuthServerClient } from "../lib/supabase/auth-server";

const items = [
  ["⌂", "总览", "/workspace"],
  ["✦", "岗位聚合", "/jobs"],
  ["↗", "投递追踪", "/applications"],
  ["◷", "求职日历", "/calendar"],
  ["▣", "简历工作台", "/resumes"],
  ["◎", "来源管理", "/sources"],
];

async function isAuthenticated() {
  if (DEMO_MODE) return true;
  const auth = await createSupabaseAuthServerClient();
  if (!auth) return false;
  const { data } = await auth.auth.getUser();
  return Boolean(data.user);
}

export async function Nav({ active = "/" }: { active?: string }) {
  const authenticated = await isAuthenticated();
  return (
    <aside className="rail">
      <Link className="brand" href="/">
        <span className="brand-mark">✦</span>
        <span><strong>ORBIT</strong><small>秋招 AI 求职中枢</small></span>
      </Link>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav" aria-label="主导航">
        {items.map(([icon, label, href]) => (
          <Link className={`nav-link ${active === href ? "active" : ""}`} href={href} key={href}>
            <span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="rail-bottom">
        <div className="rail-note">你的求职航线<br />从发现机会开始。</div>
        <Link className="rail-account" href="/account"><span>{DEMO_MODE ? "陈" : "我"}</span><div><strong>{DEMO_MODE ? "陈同学 · 演示账户" : authenticated ? "我的工作区" : "登录 / 注册"}</strong><small>{DEMO_MODE ? "AI 产品 / 算法工程" : authenticated ? "账户已连接 · 进度已同步" : "登录后同步求职进度"}</small></div><b>→</b></Link>
      </div>
    </aside>
  );
}

export async function Topbar({ hint }: { hint: string }) {
  const authenticated = await isAuthenticated();
  return <header className="topbar"><p>{hint}</p><div className="top-actions"><span className="status"><i /> {DEMO_MODE ? "演示账户已登录" : authenticated ? "账户已连接 · 进度已同步" : "登录后保存进度"}</span><Link className="avatar" href="/account" aria-label="打开账户">{DEMO_MODE ? "陈" : "我"}</Link></div></header>;
}
