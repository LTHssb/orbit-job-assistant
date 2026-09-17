"use client";

import { useMemo, useState } from "react";
import { createWorkspaceRepository } from "../lib/workspace-repository";

type Application = { id: string; company: string; title: string; stage: string; applied_at: string | null; next_action_at: string | null; notes: string | null; updated_at: string };
const stages = [
  ["interested", "感兴趣"], ["applied", "已投递"], ["screening", "筛选中"], ["interview", "面试中"], ["offer", "Offer"], ["rejected", "未通过"], ["withdrawn", "已撤回"],
] as const;

export function ApplicationTracker({ initial }: { initial: Application[] }) {
  const [applications, setApplications] = useState(initial);
  const [message, setMessage] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const workspace = useMemo(() => createWorkspaceRepository(), []);

  async function changeStage(applicationId: string, stage: string) {
    if (!workspace) { setMessage("当前是演示模式，请登录后更新投递阶段。"); return; }
    setUpdating(applicationId);
    setMessage("");
    const result = await workspace.updateApplicationStage(applicationId, stage as Parameters<NonNullable<typeof workspace>["updateApplicationStage"]>[1]);
    setUpdating(null);
    if (result.kind !== "ready") { setMessage(result.message); return; }
    setApplications((items) => items.map((item) => item.id === applicationId ? { ...item, stage, updated_at: new Date().toISOString() } : item));
    setMessage("投递阶段已更新，并已写入时间线。");
  }

  return <>
    {message && <p role="status" className="auth-message">{message}</p>}
    {applications.length ? <div className="application-list">{applications.map((application) => <article className="application-card" key={application.id}><div><span className="pill">{stages.find(([key]) => key === application.stage)?.[1] || application.stage}</span><h2>{application.title}</h2><p>{application.company}</p></div><div className="application-meta"><label>当前阶段<select className="field compact-field" value={application.stage} onChange={(event) => void changeStage(application.id, event.target.value)} disabled={updating === application.id}>{stages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><span>最近更新</span><strong>{new Date(application.updated_at).toLocaleDateString("zh-CN")}</strong></div></article>)}</div> : <div className="panel empty">还没有投递记录。<br />先去岗位聚合里收藏或加入投递追踪。</div>}
  </>;
}
