import { createSupabaseBrowserClient } from "./supabase/browser";

type WorkspaceUnavailable = {
  kind: "unavailable";
  reason: "unconfigured" | "unauthenticated";
  message: string;
};

type WorkspaceError = { kind: "error"; message: string };
type WorkspaceReady = { kind: "ready"; userId: string; jobIds: string[] };
type ApplicationReady = { kind: "ready"; userId: string; applicationId: string };
export type ReminderRecord = { id: string; title: string; reminderDate: string | null; reminderType: "interview" | "exam" | "preparation" | "reminder" };
type ReminderReady = { kind: "ready"; userId: string; reminder: ReminderRecord };
type WorkspaceResult = WorkspaceUnavailable | WorkspaceError | WorkspaceReady;
type ApplicationResult = WorkspaceUnavailable | WorkspaceError | ApplicationReady;
type ReminderResult = WorkspaceUnavailable | WorkspaceError | ReminderReady;
type ApplicationStage = "interested" | "applied" | "screening" | "interview" | "offer" | "rejected" | "withdrawn";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function createWorkspaceRepository() {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return null;
  const client = supabase;

  async function getUser() {
    const { data, error } = await client.auth.getUser();
    if (error) {
      return { user: null, error: getErrorMessage(error, "无法确认登录状态，请稍后重试。") };
    }
    return { user: data.user, error: null };
  }

  async function getSavedJobIds(): Promise<WorkspaceResult> {
    const { user, error: authError } = await getUser();
    if (authError) return { kind: "error", message: authError };
    if (!user) return { kind: "unavailable", reason: "unauthenticated", message: "登录后保存岗位。" };

    const { data, error } = await client.from("saved_jobs").select("job_id");
    if (error) return { kind: "error", message: getErrorMessage(error, "收藏加载失败，请稍后重试。") };
    return { kind: "ready", userId: user.id, jobIds: (data ?? []).map((row) => row.job_id).filter((id): id is string => typeof id === "string") };
  }

  async function setSaved(jobId: string, saved: boolean): Promise<WorkspaceResult> {
    const { user, error: authError } = await getUser();
    if (authError) return { kind: "error", message: authError };
    if (!user) return { kind: "unavailable", reason: "unauthenticated", message: "登录后保存岗位。" };

    if (saved) {
      const { error } = await client
        .from("saved_jobs")
        .upsert({ user_id: user.id, job_id: jobId }, { onConflict: "user_id,job_id", ignoreDuplicates: true });
      if (error) return { kind: "error", message: getErrorMessage(error, "收藏失败，请稍后重试。") };
    } else {
      const { data, error } = await client
        .from("saved_jobs")
        .delete()
        .eq("user_id", user.id)
        .eq("job_id", jobId)
        .select("job_id");
      if (error) return { kind: "error", message: getErrorMessage(error, "取消收藏失败，请稍后重试。") };
      if (!data?.length) return { kind: "error", message: "取消收藏未生效，请刷新后重试。" };
    }

    return { kind: "ready", userId: user.id, jobIds: [jobId] };
  }

  async function createApplication(input: { jobId: string; company: string; title: string; applicationUrl: string | null }): Promise<ApplicationResult> {
    const { user, error: authError } = await getUser();
    if (authError) return { kind: "error", message: authError };
    if (!user) return { kind: "unavailable", reason: "unauthenticated", message: "登录后加入投递追踪。" };
    const existing = await client.from("applications").select("id").eq("user_id", user.id).eq("job_id", input.jobId).maybeSingle();
    if (existing.error) return { kind: "error", message: getErrorMessage(existing.error, "查询投递记录失败，请稍后重试。") };
    if (existing.data?.id) return { kind: "ready", userId: user.id, applicationId: existing.data.id };
    const { data, error } = await client.from("applications").insert({
      user_id: user.id,
      job_id: input.jobId,
      company: input.company,
      title: input.title,
      application_url: input.applicationUrl,
      stage: "interested",
    }).select("id").single();
    if (error || !data) return { kind: "error", message: getErrorMessage(error, "创建投递记录失败，请稍后重试。") };
    const event = await client.from("application_events").insert({ application_id: data.id, user_id: user.id, event_type: "created", note: "从岗位聚合加入投递追踪" });
    if (event.error) return { kind: "error", message: getErrorMessage(event.error, "投递记录已创建，但事件写入失败。") };
    return { kind: "ready", userId: user.id, applicationId: data.id };
  }

  async function updateApplicationStage(applicationId: string, stage: ApplicationStage): Promise<ApplicationResult> {
    const { user, error: authError } = await getUser();
    if (authError) return { kind: "error", message: authError };
    if (!user) return { kind: "unavailable", reason: "unauthenticated", message: "登录后更新投递阶段。" };
    const { data, error } = await client.from("applications").update({ stage, updated_at: new Date().toISOString() }).eq("id", applicationId).eq("user_id", user.id).select("id").maybeSingle();
    if (error || !data) return { kind: "error", message: getErrorMessage(error, "更新投递阶段失败，请稍后重试。") };
    const event = await client.from("application_events").insert({ application_id: applicationId, user_id: user.id, event_type: "stage_changed", note: `投递阶段更新为 ${stage}`, metadata: { stage } });
    if (event.error) return { kind: "error", message: getErrorMessage(event.error, "阶段已更新，但事件写入失败。") };
    return { kind: "ready", userId: user.id, applicationId };
  }

  async function createReminder(input: { title: string; reminderDate: string | null; reminderType?: ReminderRecord["reminderType"] }): Promise<ReminderResult> {
    const { user, error: authError } = await getUser();
    if (authError) return { kind: "error", message: authError };
    if (!user) return { kind: "unavailable", reason: "unauthenticated", message: "登录后同步提醒。" };
    const title = input.title.trim();
    if (!title) return { kind: "error", message: "提醒内容不能为空。" };
    const { data, error } = await client.from("reminders").insert({
      user_id: user.id,
      title,
      reminder_date: input.reminderDate,
      reminder_type: input.reminderType || "reminder",
    }).select("id,title,reminder_date,reminder_type").single();
    if (error || !data) return { kind: "error", message: getErrorMessage(error, "提醒保存失败，请稍后重试。") };
    return {
      kind: "ready",
      userId: user.id,
      reminder: {
        id: data.id,
        title: data.title,
        reminderDate: data.reminder_date,
        reminderType: data.reminder_type,
      },
    };
  }

  return { getSavedJobIds, setSaved, createApplication, updateApplicationStage, createReminder };
}
