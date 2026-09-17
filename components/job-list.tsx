"use client";

import { useEffect, useMemo, useState } from "react";
import type { Job } from "../lib/jobs";
import { createWorkspaceRepository } from "../lib/workspace-repository";

function DetailModal({ job, onClose, onSave, onApply, saved, saving, applying, applied }: { job: Job; onClose: () => void; onSave: () => void; onApply: () => void; saved: boolean; saving: boolean; applying: boolean; applied: boolean }) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, unknown> | null>(null);
  const [analysisMessage, setAnalysisMessage] = useState("");

  async function analyzeJob() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalysisMessage("");
    try {
      const response = await fetch("/api/ai/jd", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: [job.title, job.company, job.description, ...job.responsibilities, ...job.requirements].filter(Boolean).join("\n") }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.message || "JD 识别失败");
      setAnalysis(payload.result || null);
    } catch (error) {
      setAnalysisMessage(error instanceof Error ? error.message : "JD 识别失败");
    } finally {
      setAnalyzing(false);
    }
  }

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <section className="job-modal" role="dialog" aria-modal="true" aria-label="岗位详情" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
      <div className="modal-kicker"><span className="job-mark">{job.company.slice(0, 1)}</span><span>{job.sourceKind === "community" ? "社区线索" : "官方来源"}</span></div>
      <h2>{job.title}</h2><p className="modal-company">{job.company} · {job.location || "地点待确认"}</p>
      <div className="modal-tags"><span>{job.salary || "薪资待官网确认"}</span><span>{job.experience || "经验不限"}</span><span>{job.education || "学历不限"}</span><span>{job.recruitmentType || "校园招聘"}</span></div>
      <div className="modal-grid"><div><h3>岗位职责</h3><p>{job.description || "该岗位的完整职责与业务背景，请进入官网 JD 查看。"}</p>{job.responsibilities.length > 0 && <ul>{job.responsibilities.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>}</div><div><h3>信息质量</h3><div className="quality-meter"><strong>{job.quality.score}</strong><span>/ 100</span></div><p>已保留原始来源与识别证据，适合进一步核对。</p></div></div>
      {analysis && <div className="ai-result"><span className="mini-label">DEEPSEEK JD INSIGHT</span><p>{typeof analysis.summary === "string" ? analysis.summary : "已完成结构化识别"}</p><div className="ai-tags">{Array.isArray(analysis.skills) && analysis.skills.slice(0, 8).map((skill) => <span key={String(skill)}>{String(skill)}</span>)}</div><small>置信度：{String(analysis.confidence ?? "—")}</small></div>}
      {analysisMessage && <p role="status" className="auth-message">{analysisMessage}</p>}
      <div className="modal-actions"><button className="button button-primary" onClick={onSave} disabled={saving}>{saving ? "处理中…" : saved ? "已收藏" : "收藏岗位"}</button><button className="button button-secondary" onClick={onApply} disabled={applying || applied}>{applying ? "加入中…" : applied ? "已加入投递" : "加入投递追踪"}</button>{job.description && <button className="button button-secondary" onClick={() => void analyzeJob()} disabled={analyzing}>{analyzing ? "DeepSeek 识别中…" : "AI 识别 JD"}</button>}{job.applicationUrl && <a className="button button-dark" href={job.applicationUrl} target="_blank" rel="noreferrer">打开官网 JD ↗</a>}</div>
    </section>
  </div>;
}

export function JobList({ jobs }: { jobs: Job[] }) {
  const [keyword, setKeyword] = useState("");
  const [company, setCompany] = useState("全部公司");
  const [city, setCity] = useState("全部城市");
  const [education, setEducation] = useState("全部学历");
  const [experience, setExperience] = useState("全部经验");
  const [recruitmentType, setRecruitmentType] = useState("全部类型");
  const [category, setCategory] = useState("全部职类");
  const [sort, setSort] = useState("最新更新");
  const [selected, setSelected] = useState<Job | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [workspaceMessage, setWorkspaceMessage] = useState("");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const workspace = useMemo(() => createWorkspaceRepository(), []);
  const companies = useMemo(() => ["全部公司", ...Array.from(new Set(jobs.map((job) => job.company))).slice(0, 30)], [jobs]);
  const cities = useMemo(() => ["全部城市", ...Array.from(new Set(jobs.map((job) => job.location).filter((value): value is string => Boolean(value)))).slice(0, 30)], [jobs]);
  const educations = useMemo(() => ["全部学历", ...Array.from(new Set(jobs.map((job) => job.education).filter((value): value is string => Boolean(value)))).slice(0, 20)], [jobs]);
  const experiences = useMemo(() => ["全部经验", ...Array.from(new Set(jobs.map((job) => job.experience).filter((value): value is string => Boolean(value)))).slice(0, 20)], [jobs]);
  const recruitmentTypes = useMemo(() => ["全部类型", ...Array.from(new Set(jobs.map((job) => job.recruitmentType).filter((value): value is string => Boolean(value)))).slice(0, 20)], [jobs]);
  const categories = useMemo(() => ["全部职类", ...Array.from(new Set(jobs.map((job) => job.category).filter((value): value is string => Boolean(value)))).slice(0, 20)], [jobs]);
  const filtered = useMemo(() => jobs.filter((job) => {
    const haystack = `${job.company} ${job.title} ${job.category ?? ""} ${job.description ?? ""}`.toLowerCase();
    return (!keyword || haystack.includes(keyword.toLowerCase())) && (company === "全部公司" || job.company === company) && (city === "全部城市" || job.location === city) && (education === "全部学历" || job.education === education) && (experience === "全部经验" || job.experience === experience) && (recruitmentType === "全部类型" || job.recruitmentType === recruitmentType) && (category === "全部职类" || job.category === category);
  }), [jobs, keyword, company, city, education, experience, recruitmentType, category]);
  const sorted = useMemo(() => [...filtered].sort((a, b) => sort === "质量优先" ? b.quality.score - a.quality.score : sort === "公司 A-Z" ? a.company.localeCompare(b.company, "zh-CN") : new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()), [filtered, sort]);

  useEffect(() => {
    let cancelled = false;
    if (!workspace) {
      setWorkspaceMessage("演示模式：登录后保存岗位。");
      return () => { cancelled = true; };
    }

    void workspace.getSavedJobIds().then((result) => {
      if (cancelled) return;
      if (result.kind === "ready") {
        setSavedIds(result.jobIds);
        setWorkspaceMessage("");
      } else {
        setWorkspaceMessage(result.message);
      }
    });
    return () => { cancelled = true; };
  }, [workspace]);

  async function toggleSave(id: string) {
    if (savingId) return;
    const nextSaved = !savedIds.includes(id);
    if (!workspace) {
      setWorkspaceMessage("演示模式：登录后保存岗位。");
      return;
    }

    setSavingId(id);
    setWorkspaceMessage("");
    const previousIds = savedIds;
    setSavedIds((current) => nextSaved ? [...current, id] : current.filter((item) => item !== id));
    const result = await workspace.setSaved(id, nextSaved);
    setSavingId(null);
    if (result.kind !== "ready") {
      setSavedIds(previousIds);
      setWorkspaceMessage(result.message);
    }
  }

  async function addApplication(job: Job) {
    if (!workspace) {
      setWorkspaceMessage("演示模式：登录后加入投递追踪。");
      return;
    }
    setApplyingId(job.id);
    const result = await workspace.createApplication({ jobId: job.id, company: job.company, title: job.title, applicationUrl: job.applicationUrl });
    setApplyingId(null);
    if (result.kind === "ready") {
      setAppliedIds((current) => current.includes(job.id) ? current : [...current, job.id]);
      setWorkspaceMessage("已加入投递追踪，可在投递追踪页更新阶段。");
    } else {
      setWorkspaceMessage(result.message);
    }
  }

  return <>
    <div className="filter-bar"><div className="search-field"><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索职位、公司或关键词" aria-label="搜索职位" /></div><select className="field compact-field" value={company} onChange={(event) => setCompany(event.target.value)} aria-label="筛选公司">{companies.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={city} onChange={(event) => setCity(event.target.value)} aria-label="筛选城市">{cities.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="筛选职类">{categories.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={education} onChange={(event) => setEducation(event.target.value)} aria-label="筛选学历">{educations.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={experience} onChange={(event) => setExperience(event.target.value)} aria-label="筛选经验">{experiences.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={recruitmentType} onChange={(event) => setRecruitmentType(event.target.value)} aria-label="筛选招聘类型">{recruitmentTypes.map((item) => <option key={item}>{item}</option>)}</select><select className="field compact-field" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序"><option>最新更新</option><option>质量优先</option><option>公司 A-Z</option></select><span className="result-count">找到 {filtered.length} 个机会</span></div>
    {workspaceMessage && <p role="status" className="auth-message">{workspaceMessage}</p>}
    <div className="job-list">
      {sorted.length ? sorted.slice(0, 80).map((job) => <article className="job-card" key={job.id} onClick={() => setSelected(job)}>
        <span className="job-mark">{job.company.slice(0, 1)}</span><div className="job-main"><div className="job-top"><span className="job-title">{job.title}</span>{job.isNew && <span className="pill pill-green">NEW</span>}<span className="pill">{job.quality.level === "high" ? "官方已核验" : job.quality.level === "medium" ? "信息较完整" : "待补充"}</span></div><div className="job-company">{job.company} <span>·</span> {job.category || "研发岗位"}</div><div className="job-desc">{job.description || "岗位详情、职责与要求以官网页面为准，点击查看完整信息。"}</div><div className="job-meta"><span>⌖ {job.location || "地点待定"}</span><span>◷ {job.experience || "经验不限"}</span><span>▣ {job.education || "学历不限"}</span><span>◌ {job.recruitmentType || "校招"}</span></div></div><div className="job-side"><button className={`save-button ${savedIds.includes(job.id) ? "saved" : ""}`} onClick={(event) => { event.stopPropagation(); void toggleSave(job.id); }} disabled={savingId === job.id} aria-label={savedIds.includes(job.id) ? "取消收藏" : "收藏岗位"}>{savedIds.includes(job.id) ? "♥" : "♡"}</button><span className="job-salary">{job.salary || "官网查看"}</span><span className="job-date">{job.publishedAt ? new Date(job.publishedAt).toLocaleDateString("zh-CN") : "待更新"}</span></div>
      </article>) : <div className="panel empty"><strong>没有找到匹配岗位</strong><br /><span>换一个关键词，或者清空筛选条件再试试。</span></div>}
    </div>
    {selected && <DetailModal job={selected} onClose={() => setSelected(null)} onSave={() => { void toggleSave(selected.id); }} onApply={() => { void addApplication(selected); }} saving={savingId === selected.id} saved={savedIds.includes(selected.id)} applying={applyingId === selected.id} applied={appliedIds.includes(selected.id)} />}
  </>;
}
