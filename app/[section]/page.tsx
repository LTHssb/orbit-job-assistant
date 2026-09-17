import { Nav, Topbar } from "../../components/nav";
import { CalendarPrototype, ResumePrototype, SourcesPrototype, type Source } from "../../components/workspace-panel";
import { getJobSnapshot } from "../../lib/jobs";
import { createSupabaseAuthServerClient } from "../../lib/supabase/auth-server";
import type { ReminderRecord } from "../../lib/workspace-repository";

export const dynamic = "force-dynamic";

const labels: Record<string, { title: string; kicker: string; hint: string }> = {
  calendar: { title: "求职日历", kicker: "CAREER CALENDAR", hint: "求职日历 · 把重要节点放在今天之前" },
  resumes: { title: "简历工作台", kicker: "RESUME WORKBENCH", hint: "简历工作台 · 让经历更接近目标岗位" },
  sources: { title: "来源管理", kicker: "SOURCE NETWORK", hint: "来源管理 · 让新的机会自动靠近你" },
};

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const meta = labels[section] ?? { title: "工作区", kicker: "WORKSPACE", hint: "ORBIT · 你的求职工作区" };
  let sourceProps: { initialSources?: Source[] } = {};
  let initialReminders: ReminderRecord[] | undefined;
  if (section === "calendar") {
    const supabase = await createSupabaseAuthServerClient();
    if (supabase) {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        initialReminders = [];
        const { data } = await supabase.from("reminders").select("id,title,reminder_date,reminder_type").order("reminder_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: false });
        initialReminders = (data ?? []).map((row) => ({
          id: row.id,
          title: row.title,
          reminderDate: row.reminder_date,
          reminderType: row.reminder_type === "interview" || row.reminder_type === "exam" || row.reminder_type === "preparation" ? row.reminder_type : "reminder",
        }));
      }
    }
  }
  if (section === "sources") {
    const snapshot = await getJobSnapshot();
    const tones = ["blue", "dark", "red", "orange", "violet"];
    const officialNames: Array<[string, string]> = [
      ["join.qq.com", "腾讯"],
      ["jobs.bytedance.com", "字节跳动"],
      ["zhaopin.meituan.com", "美团"],
      ["talent.alibaba.com", "阿里巴巴"],
      ["talent.baidu.com", "百度"],
      ["career.huawei.com", "华为"],
      ["campus.jd.com", "京东"],
      ["hr.xiaomi.com", "小米"],
      ["campus.163.com", "网易"],
      ["campus.pinduoduo.com", "拼多多"],
    ];
    const displayName = (source: (typeof snapshot.sourceStatus)[number]) => {
      const host = source.url.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
      return officialNames.find(([knownHost]) => host === knownHost || host.endsWith(`.${knownHost}`))?.[1] ?? source.name;
    };
    const mappedSources: Source[] = snapshot.sourceStatus.map((source, index) => ({
      name: displayName(source),
      url: source.url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      status: source.ok ? "已同步" : "待检查",
      jobs: source.items,
      tone: tones[index % tones.length],
    }));
    const auth = await createSupabaseAuthServerClient();
    if (auth) {
      const { data: userData } = await auth.auth.getUser();
      if (userData.user) {
        const { data: userSources } = await auth.from("user_sources").select("source_id,display_name,is_active").eq("user_id", userData.user.id).order("updated_at", { ascending: false });
        const sourceIds = (userSources ?? []).map((source) => source.source_id).filter((sourceId): sourceId is string => typeof sourceId === "string");
        if (sourceIds.length) {
          const [{ data: sourceRows }, { data: linkedJobs }] = await Promise.all([
            auth.from("job_sources").select("id,homepage_url").in("id", sourceIds),
            auth.from("jobs").select("source_id").eq("status", "active").in("source_id", sourceIds),
          ]);
          const sourceById = new Map((sourceRows ?? []).map((source) => [source.id, source]));
          const jobCounts = new Map<string, number>();
          for (const job of linkedJobs ?? []) if (job.source_id) jobCounts.set(job.source_id, (jobCounts.get(job.source_id) ?? 0) + 1);
          for (const source of userSources ?? []) {
            const homepage = sourceById.get(source.source_id)?.homepage_url;
            if (!homepage) continue;
            mappedSources.push({ name: source.display_name, url: homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""), status: source.is_active ? "我的来源 · 已同步" : "我的来源 · 已停用", jobs: jobCounts.get(source.source_id) ?? 0, tone: "violet", sourceId: source.source_id, managed: true, active: source.is_active });
          }
        }
      }
    }
    const dedupedSources = mappedSources.reduce<Source[]>((result, source) => {
      const host = source.url.split("/")[0].toLowerCase();
      const existingIndex = result.findIndex((item) => item.url.split("/")[0].toLowerCase() === host);
      if (existingIndex < 0) {
        result.push(source);
        return result;
      }
      const existing = result[existingIndex];
      if (source.managed || existing.managed) {
        const preferred = source.jobs > existing.jobs ? source : existing;
        result[existingIndex] = { ...preferred, sourceId: source.sourceId || existing.sourceId, managed: true, active: source.active ?? existing.active, status: source.managed ? source.status : existing.status };
      } else if (source.jobs > existing.jobs) result[existingIndex] = source;
      return result;
    }, []);
    sourceProps.initialSources = dedupedSources.length ? dedupedSources : undefined;
  }
  const content = section === "sources" ? <SourcesPrototype {...sourceProps} /> : section === "resumes" ? <ResumePrototype /> : section === "calendar" ? <CalendarPrototype initialReminders={initialReminders} /> : <div className="panel empty">这个工作区即将开放。</div>;
  return <div className="shell"><Nav active={`/${section}`} /><main className="main"><Topbar hint={meta.hint} /><div className="content"><div className="page-title"><div><p className="eyebrow eyebrow-dark">{meta.kicker}</p><h1>{meta.title}</h1><p>一套围绕求职行动设计的个人工作区，记录每一次靠近目标的进度。</p></div></div>{content}</div></main></div>;
}
