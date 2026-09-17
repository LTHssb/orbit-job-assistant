import Link from "next/link";
import { createSupabaseAuthServerClient } from "../../lib/supabase/auth-server";
import { DEMO_MODE, DEMO_USER } from "../../lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createSupabaseAuthServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (DEMO_MODE && !user) {
    return <main className="auth-shell"><section className="account-card demo-account-card"><span className="demo-ribbon">PORTFOLIO DEMO</span><p className="eyebrow">ORBIT · PERSONAL WORKSPACE</p><div className="demo-profile-head"><span className="demo-avatar">陈</span><div><h1>{DEMO_USER.displayName}</h1><p>{DEMO_USER.role} · {DEMO_USER.graduationYear} 届</p></div></div><p className="auth-intro">当前为作品集演示账户，完整展示收藏、投递和个人工作区状态。真实登录接入后可切换为个人数据。</p><div className="account-stats"><div><strong>08</strong><span>收藏岗位</span></div><div><strong>05</strong><span>投递记录</span></div><div><strong>{DEMO_USER.graduationYear}</strong><span>毕业年份</span></div></div><div className="account-links"><Link href="/jobs">继续探索岗位 →</Link><Link href="/applications">查看投递追踪 →</Link></div><p className="account-email">演示邮箱：{DEMO_USER.email}</p></section></main>;
  }
  if (!user) {
    return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">ORBIT · ACCOUNT</p><h1>先登录，再进入你的工作区。</h1><p className="auth-intro">岗位聚合可以直接浏览，收藏和投递记录需要账户归属。</p><Link className="hero-cta" href="/auth">去登录 / 注册</Link></section></main>;
  }

  const { data: profile } = await supabase!.from("profiles").select("display_name,target_roles,preferred_cities,education,graduation_year").eq("id", user.id).maybeSingle();
  const { count: savedCount } = await supabase!.from("saved_jobs").select("job_id", { count: "exact", head: true });
  const { count: applicationCount } = await supabase!.from("applications").select("id", { count: "exact", head: true });

  return <main className="auth-shell"><section className="account-card"><p className="eyebrow">ORBIT · PERSONAL WORKSPACE</p><h1>{profile?.display_name || user.email || "我的账户"}</h1><p className="auth-intro">你的收藏和投递只对当前账户可见。</p><div className="account-stats"><div><strong>{savedCount ?? 0}</strong><span>收藏岗位</span></div><div><strong>{applicationCount ?? 0}</strong><span>投递记录</span></div><div><strong>{profile?.graduation_year || "—"}</strong><span>毕业年份</span></div></div><div className="account-links"><Link href="/jobs">继续探索岗位 →</Link><Link href="/applications">查看投递追踪 →</Link></div><p className="account-email">登录邮箱：{user.email}</p><form action="/auth/signout" method="post"><button className="auth-switch" type="submit">退出登录</button></form></section></main>;
}
