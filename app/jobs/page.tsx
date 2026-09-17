import { Nav, Topbar } from "../../components/nav";
import { compactJobs, getJobSnapshot } from "../../lib/jobs";
import { JobList } from "../../components/job-list";

export const dynamic = "force-dynamic";

export default async function JobsPage() {
  const snapshot = await getJobSnapshot();
  const jobs = compactJobs(snapshot.jobs);
  return <div className="shell"><Nav active="/jobs" /><main className="main"><Topbar hint="岗位聚合 · 找到值得投递的下一站" /><div className="content"><div className="page-title page-title-wide"><div><p className="eyebrow eyebrow-dark">OPPORTUNITY RADAR</p><h1>岗位聚合</h1><p>官方岗位优先，社区线索辅助。每个机会都保留来源、质量和官网入口。</p></div><div className="page-stats"><strong>{jobs.length}</strong><span>条可探索岗位</span></div></div><div className="jobs-layout"><section><JobList jobs={jobs} /></section><aside className="panel side-card insight-card"><div className="insight-icon">✦</div><span className="mini-label">TODAY'S SIGNAL</span><h3>先看高质量机会</h3><p>优先关注官方已核验、信息完整度高的岗位，再用城市和公司做第二轮筛选。</p><div className="side-list"><div className="side-row"><span>数据来源</span><strong>{snapshot.sourceStatus?.filter((item) => item.ok).length || 0} 个</strong></div><div className="side-row"><span>快照更新时间</span><strong>{snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleDateString("zh-CN") : "待同步"}</strong></div><div className="side-row"><span>当前模式</span><strong>{snapshot.provider === "supabase" ? "云端数据" : "原型快照"}</strong></div></div><div className="insight-tip">点击任意岗位卡片，查看完整 JD 摘要与官网入口。</div></aside></div></div></main></div>;
}
