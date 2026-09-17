import Link from "next/link";
import { Nav, Topbar } from "../../components/nav";
import { compactJobs, getJobSnapshot } from "../../lib/jobs";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const snapshot = await getJobSnapshot();
  const jobs = compactJobs(snapshot.jobs);
  const featured = jobs.slice(0, 3);
  const sources = (snapshot.sourceStatus ?? []).slice(0, 5);
  const companies = new Set(jobs.map((job) => job.company)).size;
  return <div className="shell"><Nav active="/workspace" /><main className="main"><Topbar hint="一张地图，掌握你的秋招进度" /><div className="content home-content">
    <section className="hero"><div className="hero-copy"><p className="eyebrow">ORBIT · CAREER CONTROL CENTER</p><h1>把机会，<br />放进你的航线。</h1><p>从真实岗位发现，到投递跟踪、面试准备和 Offer 复盘，ORBIT 让每一次求职行动都更有方向。</p><Link className="hero-cta" href="/jobs">探索岗位聚合 →</Link></div><div className="hero-orbit"><span>03</span><small>正在靠近<br />目标机会</small></div></section>
    <div className="section-head"><div><p className="eyebrow eyebrow-dark">YOUR FLIGHT PLAN</p><h2>航线概览</h2><p>今天也向目标靠近一点。</p></div><span className="text-link">数据快照 · {snapshot.updatedAt ? "已同步" : "待同步"}</span></div>
    <section className="stat-grid"><div className="stat-card stat-primary"><span>岗位总数</span><strong>{jobs.length || "—"}</strong><em>覆盖 {companies || "—"} 家公司</em><i>↗</i></div><div className="stat-card"><span>待投递</span><strong>12</strong><em>建立账户后开启</em><i>＋</i></div><div className="stat-card"><span>本周面试</span><strong>03</strong><em>在日历中安排</em><i>◷</i></div><div className="stat-card"><span>岗位来源</span><strong>{snapshot.sourceStatus?.length || "—"}</strong><em>官方与社区线索</em><i>◎</i></div></section>
    <div className="section-head"><div><p className="eyebrow eyebrow-dark">FRESH OPPORTUNITIES</p><h2>刚刚捕获的机会</h2><p>从今天最值得打开的岗位开始。</p></div><Link className="text-link" href="/jobs">查看全部 →</Link></div>
    <section className="featured-grid">{featured.map((job, index) => <Link className="featured-card" href="/jobs" key={job.id}><div className="featured-number">0{index + 1}</div><div><span className="pill">{job.quality.level === "high" ? "官方已核验" : "新线索"}</span><h3>{job.title}</h3><p>{job.company} · {job.location || "全国"}</p><span className="featured-meta">{job.salary || "官网查看"} <b>→</b></span></div></Link>)}</section>
    <div className="section-head"><div><p className="eyebrow eyebrow-dark">SOURCE NETWORK</p><h2>正在观测的来源</h2><p>优先从官方招聘入口获取岗位信息。</p></div><Link className="text-link" href="/sources">管理来源 →</Link></div><section className="panel source-grid">{sources.map((source) => <div className="source" key={source.id}><span className="source-logo">✦</span><span><strong>{source.name}</strong><small>{source.ok ? "连接正常" : "待检查"}</small></span></div>)}</section>
  </div></main></div>;
}
