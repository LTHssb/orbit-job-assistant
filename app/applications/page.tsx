import Link from "next/link";
import { Nav, Topbar } from "../../components/nav";
import { DEMO_MODE } from "../../lib/supabase/env";
import { createSupabaseAuthServerClient } from "../../lib/supabase/auth-server";
import { ApplicationTracker } from "../../components/application-tracker";

export const dynamic = "force-dynamic";

const stages: Record<string, string> = { interested: "感兴趣", applied: "已投递", screening: "筛选中", interview: "面试中", offer: "Offer", rejected: "未通过", withdrawn: "已撤回" };

export default async function ApplicationsPage() {
  const supabase = await createSupabaseAuthServerClient();
  const user = supabase ? (await supabase.auth.getUser()).data.user : null;
  if (DEMO_MODE && !user) return <div className="shell"><Nav active="/applications" /><main className="main"><Topbar hint="投递追踪 · 让每一次行动都有下一步" /><div className="content"><div className="page-title"><div><p className="eyebrow eyebrow-dark">APPLICATION TRACKER</p><h1>投递追踪</h1><p>陈同学的求职航线 · 2026 秋招进行中</p></div><Link className="text-link" href="/jobs">从岗位创建记录 →</Link></div><div className="application-demo-summary"><div><span>本周行动</span><strong>04</strong><small>保持节奏，继续靠近</small></div><div><span>面试进行中</span><strong>02</strong><small>下一场：字节一面</small></div><div><span>待跟进</span><strong>03</strong><small>有 1 项今日到期</small></div></div><div className="application-list">{[{id:"demo-1",stage:"interview",title:"算法工程师 · 推荐方向",company:"字节跳动",updated_at:"2026-08-12"},{id:"demo-2",stage:"applied",title:"AI 产品经理 · 校招",company:"百度",updated_at:"2026-08-11"},{id:"demo-3",stage:"screening",title:"大模型算法工程师",company:"腾讯",updated_at:"2026-08-09"}].map((application) => <article className="application-card" key={application.id}><div><span className="pill">{stages[application.stage]}</span><h2>{application.title}</h2><p>{application.company}</p></div><div className="application-meta"><span>最近更新</span><strong>{new Date(application.updated_at).toLocaleDateString("zh-CN")}</strong></div></article>)}</div></div></main></div>;
  if (!user) return <div className="shell"><Nav active="/applications" /><main className="main"><Topbar hint="投递追踪 · 让每一次行动都有下一步" /><div className="content"><div className="page-title"><div><p className="eyebrow eyebrow-dark">APPLICATION TRACKER</p><h1>投递追踪</h1><p>登录后，你的投递记录会按账户安全保存。</p></div></div><div className="panel empty"><Link className="text-link" href="/auth">登录 / 注册 →</Link></div></div></main></div>;

  const { data: applications, error } = await supabase!.from("applications").select("id,company,title,stage,applied_at,next_action_at,notes,updated_at").order("updated_at", { ascending: false });
  return <div className="shell"><Nav active="/applications" /><main className="main"><Topbar hint="投递追踪 · 让每一次行动都有下一步" /><div className="content"><div className="page-title"><div><p className="eyebrow eyebrow-dark">APPLICATION TRACKER</p><h1>投递追踪</h1><p>把每一次投递都放在正确的下一步。</p></div><Link className="text-link" href="/jobs">从岗位创建记录 →</Link></div>{error ? <div className="panel empty">暂时无法读取投递记录，请稍后重试。</div> : <ApplicationTracker initial={applications ?? []} />}</div></main></div>;
}
