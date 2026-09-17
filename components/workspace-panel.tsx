"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useMemo } from "react";
import { createWorkspaceRepository, type ReminderRecord } from "../lib/workspace-repository";

export type Source = { name: string; url: string; status: string; jobs: number; tone: string; sourceId?: string; managed?: boolean; active?: boolean };

type ResumeAnalysisView = {
  summary: string;
  targetRoles: string[];
  skills: string[];
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  experiences: string[];
  score: number;
};

function readResumeAnalysis(value: unknown): ResumeAnalysisView | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const list = (candidate: unknown) => Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string") : [];
  return {
    summary: typeof input.summary === "string" ? input.summary : "",
    targetRoles: list(input.targetRoles),
    skills: list(input.skills),
    strengths: list(input.strengths),
    gaps: list(input.gaps),
    suggestions: list(input.suggestions),
    experiences: list(input.experiences),
    score: typeof input.score === "number" ? input.score : 0,
  };
}

const initialSourcesFallback: Source[] = [
  { name: "腾讯", url: "join.qq.com", status: "已同步", jobs: 42, tone: "blue" },
  { name: "字节跳动", url: "jobs.bytedance.com", status: "已同步", jobs: 36, tone: "dark" },
  { name: "百度", url: "talent.baidu.com", status: "已同步", jobs: 28, tone: "red" },
  { name: "阿里巴巴", url: "talent.alibaba.com", status: "监测中", jobs: 31, tone: "orange" },
];

type SourceImportResult = {
  ok: boolean;
  jobs: number;
  source: string;
  url: string;
  method: string;
  stage: string;
  message: string;
  taskId?: string;
  sourceId?: string;
  adapterKey?: string;
  adapterStatus?: string;
};

function sourceHost(url: string) {
  return url.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
}

function mergeSource(list: Source[], incoming: Source) {
  const host = sourceHost(incoming.url);
  const existingIndex = list.findIndex((source) => sourceHost(source.url) === host);
  if (existingIndex < 0) return [...list, incoming];
  return list.map((source, index) => {
    if (index !== existingIndex) return source;
    const preferred = incoming.jobs >= source.jobs ? incoming : source;
    return { ...preferred, jobs: Math.max(source.jobs, incoming.jobs), sourceId: incoming.sourceId || source.sourceId, managed: incoming.managed || source.managed, active: incoming.active ?? source.active };
  });
}

export function SourcesPrototype({ initialSources = initialSourcesFallback }: { initialSources?: Source[] }) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [company, setCompany] = useState("百度");
  const [url, setUrl] = useState("https://talent.baidu.com/jobs/list");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<SourceImportResult | null>(null);
  const [sourceAction, setSourceAction] = useState("");
  const [sourceMessage, setSourceMessage] = useState("");

  async function addSource() {
    const submittedCompany = company.trim();
    const submittedUrl = url.trim();
    if (!submittedCompany || !submittedUrl || isSubmitting) {
      setResult({ ok: false, jobs: 0, source: submittedCompany, url: submittedUrl, method: "validation", stage: "validation", message: "请先填写公司名称和招聘官网地址" });
      return;
    }
    setIsSubmitting(true);
    setResult(null);
    try {
      const finishImport = (completed: SourceImportResult) => {
        setResult(completed);
        if (completed.ok) {
          setSources((current) => mergeSource(current, { name: completed.source, url: completed.url.replace(/^https?:\/\//, ""), status: `已导入 ${completed.jobs} 条岗位`, jobs: completed.jobs, tone: "violet", sourceId: completed.sourceId, managed: Boolean(completed.sourceId), active: true }));
          router.refresh();
        }
      };
      const response = await fetch("/api/sources/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: submittedCompany, url: submittedUrl }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 503 || response.status === 404) {
        const fallbackResponse = await fetch("/api/sources/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company: submittedCompany, url: submittedUrl }),
        });
        const fallback = await fallbackResponse.json().catch(() => ({}));
        if (!fallbackResponse.ok && !fallback.ok) throw new Error(payload.message || fallback.message || "后台任务服务暂不可用");
        finishImport({
          ok: Boolean(fallback.ok && fallback.jobs?.length),
          jobs: Array.isArray(fallback.jobs) ? fallback.jobs.length : Number(fallback.persistence?.jobs || 0),
          source: submittedCompany,
          url: submittedUrl,
          method: fallback.method || "sync-fallback",
          stage: fallback.stage || "completed",
          adapterKey: fallback.adapterKey,
          sourceId: fallback.persistence?.sourceId,
          adapterStatus: fallback.adapterStatus,
          message: fallback.message || "已完成服务端导入",
        });
        return;
      }
      if (response.status === 202 && payload.taskId) {
        setResult({ ok: true, jobs: 0, source: submittedCompany, url: submittedUrl, method: payload.adapterKey || "task", stage: "queued", taskId: payload.taskId, sourceId: payload.sourceId, adapterKey: payload.adapterKey, adapterStatus: payload.adapterStatus, message: payload.message || "采集任务已创建，正在后台识别" });
        for (let attempt = 0; attempt < 45; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
          const taskResponse = await fetch(`/api/sources/tasks?id=${encodeURIComponent(payload.taskId)}`, { cache: "no-store" });
          const task = await taskResponse.json().catch(() => ({}));
          if (!taskResponse.ok) throw new Error(task.message || "任务状态查询失败");
          if (task.status === "running") {
            setResult((current) => current ? { ...current, stage: "running", message: task.message || "正在识别并写入岗位" } : current);
            continue;
          }
          const completed: SourceImportResult = {
            ok: task.status === "succeeded" || task.status === "partial",
            jobs: Number(task.acceptedCount || 0),
            source: submittedCompany,
            url: submittedUrl,
            method: payload.adapterKey || "task",
            stage: task.status || "failed",
            taskId: payload.taskId,
            sourceId: payload.sourceId,
            adapterKey: payload.adapterKey,
            adapterStatus: payload.adapterStatus,
            message: task.message || "采集任务已完成",
          };
          finishImport(completed);
          return;
        }
        setResult((current) => current ? { ...current, ok: false, stage: "timeout", message: "任务仍在后台执行，请稍后刷新岗位聚合页查看结果" } : current);
        return;
      }
      throw new Error(payload.message || `请求失败（HTTP ${response.status}）`);
    } catch (error) {
      setResult({ ok: false, jobs: 0, source: submittedCompany, url: submittedUrl, method: "request", stage: "request", message: error instanceof Error ? error.message : "网络请求失败，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function manageSource(source: Source, action: "toggle" | "retry") {
    if (!source.sourceId || sourceAction) return;
    const actionKey = `${source.sourceId}:${action}`;
    setSourceAction(actionKey);
    setSourceMessage("");
    try {
      const response = await fetch("/api/sources/mine", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "toggle" ? { action: "active", sourceId: source.sourceId, active: source.active === false } : { action: "retry", sourceId: source.sourceId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "来源操作失败，请稍后重试");
      if (action === "toggle") {
        const active = payload.active === true;
        setSources((current) => current.map((item) => item.sourceId === source.sourceId ? { ...item, active, status: active ? "我的来源 · 已同步" : "我的来源 · 已停用" } : item));
      } else {
        setSources((current) => current.map((item) => item.sourceId === source.sourceId ? { ...item, status: "我的来源 · 重新采集中…" } : item));
      }
      setSourceMessage(payload.message || "来源操作已完成");
    } catch (error) {
      setSourceMessage(error instanceof Error ? error.message : "来源操作失败，请稍后重试");
    } finally {
      setSourceAction("");
    }
  }

  return <div className="workspace-stack">
    <section className="source-intro panel"><div><span className="mini-label">SOURCE INGESTION</span><h2>让新的机会自动靠近你</h2><p>输入任何公司的校招官网，ORBIT 会尝试识别公开页面、接口和岗位详情，并保留原始来源供你复核。</p></div><div className="source-flow"><span>网址</span><b>→</b><span>识别</span><b>→</b><span>岗位列表</span></div></section>
    <section className="panel source-form"><div className="form-heading"><div><h3>添加新的招聘来源 <span className="demo-chip">支持实时采集</span></h3><p>支持官网入口、具体职位页和公开接口；登录后会绑定到你的来源网络</p></div><span className="status"><i /> 采集器在线</span></div><div className="source-inputs"><input value={company} onChange={(event) => { setCompany(event.target.value); setResult(null); }} placeholder="公司名称，例如：小红书" aria-label="公司名称" /><input value={url} onChange={(event) => { setUrl(event.target.value); setResult(null); }} placeholder="https://campus.example.com" aria-label="招聘官网地址" /><button className="button button-primary" onClick={() => void addSource()} disabled={isSubmitting}>{isSubmitting ? "识别中…" : "开始识别 →"}</button></div>{result && <div className={`capture-result ${result.ok ? "" : "capture-result-error"}`} role="status"><span className="capture-check">{result.ok ? "✓" : "!"}</span><div><strong>{result.ok ? `识别完成 · ${result.jobs} 条岗位` : `识别未完成 · ${result.source || "来源"}`}</strong><p>{result.message}</p><small>方法：{result.method} · 阶段：{result.stage} · 来源：{result.url}</small></div>{result.ok && <span className="capture-count">{result.jobs} <small>JOBS</small></span>}</div>}</section>
    <section><div className="section-head compact-head"><div><h2>我的来源网络</h2><p>{sources.length} 个来源 · 每日自动刷新，手动导入可立即触发</p></div><span className="text-link">采集状态已记录</span></div>{sourceMessage && <p className="source-action-message" role="status">{sourceMessage}</p>}<div className="source-list">{sources.map((source) => <article className="source-row" key={`${source.name}-${source.url}`}><span className={`source-logo source-${source.tone}`}>{source.name.slice(0, 1)}</span><div className="source-row-main"><h3>{source.name}</h3><p>{source.url}</p></div><div className="source-row-stat"><strong>{source.jobs || "—"}</strong><span>已识别岗位</span></div><span className="source-status"><i />{source.status}</span>{source.managed && <div className="source-row-actions"><button type="button" onClick={() => void manageSource(source, "toggle")} disabled={Boolean(sourceAction)}>{source.active === false ? "启用" : "停用"}</button><button type="button" onClick={() => void manageSource(source, "retry")} disabled={Boolean(sourceAction)}>{sourceAction === `${source.sourceId}:retry` ? "重试中…" : "重试"}</button></div>}<a className="row-more" href={`https://${source.url}`} target="_blank" rel="noreferrer" aria-label={`打开${source.name}官网`}>↗</a></article>)}</div></section>
  </div>;
}

export function ResumePrototype() {
  const [active, setActive] = useState("分析结果");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [resumeName, setResumeName] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [resumeAnalysis, setResumeAnalysis] = useState<ResumeAnalysisView | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/resumes/mine").then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      const latest = Array.isArray(payload.documents) ? payload.documents[0] : null;
      const analysis = readResumeAnalysis(latest?.analysis);
      if (active && latest && latest.status === "ready" && analysis) {
        setResumeName(typeof latest.original_name === "string" ? latest.original_name : "最近一次简历");
        setResumeAnalysis(analysis);
        setUploadMessage("已恢复最近一次简历分析结果。");
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  async function uploadResume() {
    if (!resumeFile || uploading) return;
    setUploading(true);
    setUploadMessage("");
    const formData = new FormData();
    formData.append("file", resumeFile);
    try {
      const response = await fetch("/api/resumes/upload", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUploadMessage(payload.message || "简历保存失败，请稍后重试。");
        return;
      }
      setUploadMessage(payload.message || "简历已安全保存，正在解析。");
      if (typeof payload.documentId === "string") {
        const parseResponse = await fetch("/api/resumes/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: payload.documentId }) });
        const parsePayload = await parseResponse.json().catch(() => ({}));
        if (parseResponse.ok && parsePayload.analysis && typeof parsePayload.analysis === "object") {
          const analysis = parsePayload.analysis as Partial<ResumeAnalysisView>;
          setResumeAnalysis({ summary: typeof analysis.summary === "string" ? analysis.summary : "", targetRoles: Array.isArray(analysis.targetRoles) ? analysis.targetRoles.filter((item): item is string => typeof item === "string") : [], skills: Array.isArray(analysis.skills) ? analysis.skills.filter((item): item is string => typeof item === "string") : [], strengths: Array.isArray(analysis.strengths) ? analysis.strengths.filter((item): item is string => typeof item === "string") : [], gaps: Array.isArray(analysis.gaps) ? analysis.gaps.filter((item): item is string => typeof item === "string") : [], suggestions: Array.isArray(analysis.suggestions) ? analysis.suggestions.filter((item): item is string => typeof item === "string") : [], experiences: Array.isArray(analysis.experiences) ? analysis.experiences.filter((item): item is string => typeof item === "string") : [], score: typeof analysis.score === "number" ? analysis.score : 0 });
          setUploadMessage("简历已保存，并完成 DeepSeek 初步分析。");
        } else {
          setUploadMessage(parsePayload.message || "文件已保存，但解析未完成；可以稍后重试。");
        }
      }
    } catch {
      setUploadMessage("网络暂时不可用，请稍后重试。");
    } finally {
      setUploading(false);
    }
  }
  function selectResume(file: File | undefined) {
    setResumeFile(file || null);
    setResumeName(file?.name || "");
    setUploadMessage("");
    setResumeAnalysis(null);
  }
  const score = resumeAnalysis?.score ?? 78;
  const skills = resumeAnalysis?.skills.length ? resumeAnalysis.skills : ["Python", "机器学习", "产品思维", "SQL", "项目管理", "数据分析"];
  return <div className="workspace-stack"><section className="resume-hero panel"><div><span className="mini-label">RESUME WORKBENCH</span><h2>让简历，成为你的第二张航图。</h2><p>上传一份简历，ORBIT 会提取经历、识别能力，并针对目标岗位给出可执行的优化建议。</p><div className="resume-actions"><button type="button" className="button button-primary" onClick={() => fileInputRef.current?.click()}>{resumeName ? "重新选择简历 →" : "选择简历 →"}</button>{resumeFile && <button type="button" className="button button-secondary" onClick={() => void uploadResume()} disabled={uploading}>{uploading ? "分析中…" : "安全保存并分析"}</button>}</div><input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={(event) => selectResume(event.target.files?.[0])} />{resumeName && <div className="resume-upload-status" role="status">已选择：{resumeName}<small>{uploadMessage || "登录后保存；PDF/DOCX 可自动解析，文件上限 10 MB。"}</small></div>}{uploadMessage && <p className="resume-upload-message" role="status">{uploadMessage}</p>}</div><div className="resume-score"><span>{resumeAnalysis ? "AI 分析完成度" : "演示简历完成度"}</span><strong>{score}</strong><small>/ 100</small><div className="score-line"><i style={{ width: `${score}%` }} /></div><em>{resumeAnalysis?.summary || "登录后上传自己的简历，开始真实分析"}</em></div></section><div className="workbench-tabs">{["分析结果", "岗位匹配", "优化建议"].map((item) => <button type="button" className={active === item ? "active" : ""} onClick={() => setActive(item)} key={item}>{item}</button>)}</div>{active === "分析结果" ? <section className="resume-grid"><div className="panel resume-preview"><div className="resume-paper"><div className="paper-avatar">{resumeAnalysis ? "简" : "陈"}</div><h3>{resumeAnalysis ? resumeName : "陈同学"}</h3><p>{resumeAnalysis?.targetRoles.join(" · ") || "AI 产品 / 算法工程方向"}</p><hr /><div className="paper-block"><b>{resumeAnalysis ? "识别摘要" : "教育经历"}</b><span>{resumeAnalysis?.summary || "华中科技大学 · 计算机科学与技术"}</span><small>{resumeAnalysis ? "来自本次简历文本" : "2022.09 — 2026.06"}</small></div><div className="paper-block"><b>{resumeAnalysis ? "关键经历" : "实习经历"}</b><span>{resumeAnalysis?.experiences[0] || "某头部互联网公司 · 算法实习生"}</span><small>{resumeAnalysis?.suggestions[0] || "推荐系统特征工程与模型优化"}</small></div></div></div><div className="panel analysis-card"><span className="mini-label">AI EXTRACTION</span><h3>{resumeAnalysis ? `识别到 ${skills.length} 项能力` : "识别到 12 项能力"}</h3><div className="skill-cloud">{skills.map((skill) => <span key={skill}>{skill}</span>)}</div><div className="analysis-note"><b>✓</b><p>{resumeAnalysis?.strengths[0] || "经历内容结构清晰"}<br /><small>{resumeAnalysis?.gaps[0] || "上传自己的简历后，ORBIT 会把建议替换成真实分析结果。"}</small></p></div></div></section> : <section className="panel empty prototype-empty"><strong>{active}</strong><br /><span>{resumeAnalysis ? "真实分析数据已保存，岗位匹配与建议视图将在下一轮接入。" : "这个模块将在下一轮接入真实 AI 分析结果。"}</span></section>}</div>;
}

export function CalendarPrototype({ initialReminders }: { initialReminders?: ReminderRecord[] }) {
  type CalendarEvent = { id: string; day: number | "—"; month: string; title: string; type: string; color: string; date: string | null };
  const isDemo = initialReminders === undefined;
  const workspace = useMemo(() => createWorkspaceRepository(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const demoEvents: CalendarEvent[] = [{ id: "demo-bytedance", day: 12, month: "周三", title: "字节跳动 · 一面", type: "面试", color: "purple", date: "2026-08-12" }, { id: "demo-baidu", day: 14, month: "周五", title: "完善百度算法岗简历", type: "准备", color: "orange", date: "2026-08-14" }, { id: "demo-tencent", day: 18, month: "下周三", title: "腾讯 · 笔试提醒", type: "笔试", color: "blue", date: "2026-08-18" }];
  const reminderEvents = (initialReminders ?? []).map((reminder): CalendarEvent => {
    const parsed = reminder.reminderDate ? new Date(`${reminder.reminderDate}T00:00:00`) : null;
    const typeLabels: Record<ReminderRecord["reminderType"], string> = { interview: "面试", exam: "笔试", preparation: "准备", reminder: "提醒" };
    return { id: reminder.id, day: parsed ? parsed.getDate() : "—", month: parsed ? `${parsed.getMonth() + 1}月` : "待定", title: reminder.title, type: typeLabels[reminder.reminderType], color: reminder.reminderType === "interview" ? "purple" : reminder.reminderType === "exam" ? "blue" : "orange", date: reminder.reminderDate };
  });
  const [events, setEvents] = useState<CalendarEvent[]>(() => isDemo ? demoEvents : reminderEvents);
  const [showReminder, setShowReminder] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");
  const monthDate = new Date(2026, 7 + monthOffset, 1);
  const monthLabel = `${monthDate.getFullYear()} 年 ${monthDate.getMonth() + 1} 月`;
  const dayCount = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const leadingDays = (monthDate.getDay() + 6) % 7;
  const calendarMonthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  const eventDays = events.filter((event) => event.date?.startsWith(calendarMonthKey)).map((event) => event.day);
  async function addReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draftTitle.trim();
    if (!title || savingReminder) return;
    setSavingReminder(true);
    setReminderMessage("");
    let newEvent: CalendarEvent;
    if (!isDemo) {
      if (!workspace) {
        setReminderMessage("当前环境未连接账户服务，提醒未保存。请稍后重试。");
        setSavingReminder(false);
        return;
      }
      const result = await workspace.createReminder({ title, reminderDate: draftDate || null });
      if (result.kind !== "ready") {
        setReminderMessage(result.message);
        setSavingReminder(false);
        return;
      }
      const reminder = result.reminder;
      const parsed = reminder.reminderDate ? new Date(`${reminder.reminderDate}T00:00:00`) : null;
      newEvent = { id: reminder.id, day: parsed ? parsed.getDate() : "—", month: parsed ? `${parsed.getMonth() + 1}月` : "待定", title: reminder.title, type: "提醒", color: "blue", date: reminder.reminderDate };
      setReminderMessage("提醒已保存到你的账户。");
    } else {
      newEvent = { id: `local-${Date.now()}`, day: draftDate ? new Date(`${draftDate}T00:00:00`).getDate() : "—", month: draftDate ? `${new Date(`${draftDate}T00:00:00`).getMonth() + 1}月` : "待定", title, type: "提醒", color: "blue", date: draftDate || null };
      setReminderMessage("提醒已加入演示航线；登录后可跨设备同步。");
    }
    setEvents((current) => [...current, newEvent]);
    setDraftTitle("");
    setDraftDate("");
    setShowReminder(false);
    setSavingReminder(false);
  }
  return <div className="workspace-stack"><section className="calendar-head"><div><span className="mini-label">CAREER CALENDAR</span><h2>把重要节点，放在今天之前。</h2><p>面试、笔试、截止日期和下一步行动，集中在一条时间线上。</p></div><button type="button" className="button button-primary" onClick={() => setShowReminder((current) => !current)}>{showReminder ? "收起提醒表单" : "＋ 新建提醒"}</button></section>{showReminder && <form className="source-inputs calendar-reminder-form" onSubmit={(event) => void addReminder(event)}><input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="例如：准备百度二面" aria-label="提醒内容" autoFocus /><input type="date" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} aria-label="提醒日期" /><button type="submit" className="button button-primary" disabled={savingReminder}>{savingReminder ? "保存中…" : "加入航线"}</button></form>}{reminderMessage && <p className="calendar-message" role="status">{reminderMessage}</p>}<div className="calendar-layout"><section className="panel calendar-month"><div className="calendar-toolbar"><button type="button" onClick={() => setMonthOffset((current) => current - 1)} aria-label="上个月">‹</button><strong>{monthLabel}</strong><button type="button" onClick={() => setMonthOffset((current) => current + 1)} aria-label="下个月">›</button><button type="button" onClick={() => setMonthOffset(0)} className="calendar-today">回到基准月</button></div><div className="calendar-week">{["一", "二", "三", "四", "五", "六", "日"].map((item) => <span key={item}>{item}</span>)}</div><div className="calendar-days">{Array.from({ length: leadingDays + dayCount }, (_, index) => { const day = index < leadingDays ? null : index - leadingDays + 1; return <span className={day === 12 && monthOffset === 0 && isDemo ? "today" : day && eventDays.includes(day) ? "has-event" : ""} key={`${monthOffset}-${index}`}>{day || ""}</span>; })}</div></section><aside className="panel timeline"><div className="section-head compact-head"><div><h2>近期安排</h2><p>共 {events.length} 条 · {isDemo ? "作品集演示" : "账户已同步"}</p></div><span className="text-link">已纳入航线</span></div>{events.length ? events.map((event) => <article className="timeline-item" key={event.id}><div className={`timeline-date ${event.color}`}><strong>{event.day}</strong><span>{event.month}</span></div><div><span className="pill">{event.type}</span><h3>{event.title}</h3><p>{event.day === "—" ? "等待设置日期" : "已纳入本周航线"}</p></div></article>) : <div className="calendar-empty">还没有提醒，点击“新建提醒”开始记录。</div>}</aside></div></div>;
}
