import jobSnapshot from "../data/jobs.safe.json";
import { unstable_noStore as noStore } from "next/cache";
import { normalizeJobs, type NormalizedJob, type SourceStatus } from "./job-schema";
import { getSupabaseJobSnapshot } from "./supabase/jobs-repository";

export type Job = NormalizedJob;
export type JobSnapshot = { schemaVersion: "job-schema.v1"; updatedAt: string; jobs: NormalizedJob[]; sourceStatus: SourceStatus[]; report: ReturnType<typeof normalizeJobs>["report"]; provider: "supabase" | "snapshot" };
type RawSnapshot = { updatedAt?: unknown; jobs?: unknown; sourceStatus?: unknown };

export async function getJobSnapshot(): Promise<JobSnapshot> {
  noStore();
  const remoteSnapshot = await getSupabaseJobSnapshot();
  if (remoteSnapshot) {
    return { schemaVersion: "job-schema.v1", provider: "supabase", ...remoteSnapshot };
  }
  const raw = jobSnapshot as RawSnapshot;
  const normalized = normalizeJobs(Array.isArray(raw.jobs) ? raw.jobs : [], typeof raw.updatedAt === "string" ? raw.updatedAt : undefined);
  return { schemaVersion: "job-schema.v1", provider: "snapshot", updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "", jobs: normalized.jobs, sourceStatus: Array.isArray(raw.sourceStatus) ? raw.sourceStatus as SourceStatus[] : [], report: normalized.report };
}

export function formatDate(value?: string | null) { if (!value) return "待更新"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "待更新" : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date); }
export function compactJobs(jobs: NormalizedJob[] = []) { return jobs.filter((job) => job.status === "active").slice(0, 160); }
