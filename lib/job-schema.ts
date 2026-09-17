export const JOB_SCHEMA_VERSION = "job-schema.v1" as const;

export type JobStatus = "active" | "stale" | "closed" | "hidden";
export type JobSourceKind = "official_api" | "official_page" | "official_watch" | "community" | "user_submitted" | "manual";
export type EvidenceKind = "official_api" | "official_page" | "source_snapshot" | "screenshot" | "user_input" | "community";

export type JobEvidence = { kind: EvidenceKind; url?: string; capturedAt?: string; note?: string };
export type JobQuality = { score: number; level: "high" | "medium" | "low"; missing: string[]; verifiedBy: "official" | "community" | "user" | "unknown" };
export type SourceStatus = { id: string; name: string; url: string; ok: boolean; items: number; checkedAt: string };

export type NormalizedJob = {
  schemaVersion: typeof JOB_SCHEMA_VERSION;
  id: string;
  canonicalKey: string;
  title: string;
  company: string;
  location: string | null;
  employmentType: string | null;
  recruitmentType: string | null;
  category: string | null;
  salary: string | null;
  experience: string | null;
  education: string | null;
  description: string | null;
  responsibilities: string[];
  requirements: string[];
  benefits: string[];
  applicationUrl: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  sourceKind: JobSourceKind;
  publishedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  status: JobStatus;
  isNew: boolean;
  evidence: JobEvidence[];
  quality: JobQuality;
  raw: Record<string, unknown>;
};

export type RawJobRecord = { [key: string]: unknown; id?: unknown; src?: unknown; co?: unknown; po?: unknown; city?: unknown; sal?: unknown; exp?: unknown; edu?: unknown; type?: unknown; category?: unknown; sourceKind?: unknown; pub?: unknown; isNew?: unknown; url?: unknown; sourceUrl?: unknown; applicationUrl?: unknown; description?: unknown; responsibilities?: unknown; requirements?: unknown; benefits?: unknown; status?: unknown; firstSeenAt?: unknown; lastSeenAt?: unknown };
export type NormalizationIssue = { id: string | null; field: string; message: string };
export type NormalizationReport = { total: number; accepted: number; rejected: number; duplicates: number; issues: NormalizationIssue[] };

const text = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => text(item)).filter((item): item is string => Boolean(item));
    return normalized.length ? normalized.join("、") : null;
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized || null;
};
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter((item): item is string => Boolean(item)) : (text(value)?.split(/[\n；;]+/).map((item) => item.trim()).filter(Boolean) ?? []);
const date = (value: unknown, fallback: string | null = null): string | null => { const valueText = text(value); if (!valueText) return fallback; const parsed = new Date(valueText); return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString(); };
const url = (value: unknown): string | null => { const valueText = text(value); if (!valueText) return null; try { const parsed = new URL(valueText); return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null; } catch { return null; } };
const sourceKind = (value: unknown): JobSourceKind => { const valueText = text(value); if (valueText === "json" || valueText === "official_api") return "official_api"; if (valueText === "watch" || valueText === "official_watch") return "official_watch"; if (valueText === "official_page" || valueText === "official-recognized") return "official_page"; if (valueText === "community") return "community"; if (valueText === "user_submitted") return "user_submitted"; return "manual"; };
const status = (value: unknown): JobStatus => { const valueText = text(value); return valueText === "closed" || valueText === "stale" || valueText === "hidden" ? valueText : "active"; };

function canonicalKey(company: string, title: string, location: string | null, applicationUrl: string | null) {
  if (applicationUrl) return `url:${applicationUrl.toLowerCase()}`;
  return `job:${[company, title, location ?? ""].join("|").toLowerCase().replace(/\s+/g, "-")}`;
}

function qualityOf(job: Omit<NormalizedJob, "quality">): JobQuality {
  const fields: Array<[string, unknown]> = [["location", job.location], ["salary", job.salary], ["experience", job.experience], ["education", job.education], ["category", job.category], ["applicationUrl", job.applicationUrl], ["sourceUrl", job.sourceUrl]];
  const missing = fields.filter(([, value]) => !value || value === "官网查看").map(([field]) => field);
  const official = job.sourceKind === "official_api" || job.sourceKind === "official_page";
  const score = Math.max(0, Math.min(100, 45 + (official ? 25 : job.sourceKind === "official_watch" ? 10 : 0) + (fields.length - missing.length) * 4));
  return { score, level: score >= 80 ? "high" : score >= 60 ? "medium" : "low", missing, verifiedBy: official ? "official" : job.sourceKind === "community" ? "community" : job.sourceKind === "user_submitted" ? "user" : "unknown" };
}

export function normalizeJob(raw: RawJobRecord, snapshotAt = new Date().toISOString()): { job: NormalizedJob | null; issues: NormalizationIssue[] } {
  const issues: NormalizationIssue[] = [];
  const id = text(raw.id), company = text(raw.company ?? raw.co), title = text(raw.title ?? raw.po);
  if (!id) issues.push({ id: null, field: "id", message: "岗位缺少稳定 id" });
  if (!company) issues.push({ id, field: "company", message: "岗位缺少公司名称" });
  if (!title) issues.push({ id, field: "title", message: "岗位缺少职位名称" });
  if (!id || !company || !title) return { job: null, issues };
  const applicationUrl = url(raw.applicationUrl ?? raw.url), sourceUrl = url(raw.sourceUrl ?? raw.url);
  const firstSeenAt = date(raw.firstSeenAt, date(raw.pub, snapshotAt)) ?? snapshotAt;
  const lastSeenAt = date(raw.lastSeenAt, snapshotAt) ?? snapshotAt;
  const kind = sourceKind(raw.sourceKind);
  const location = text(raw.location ?? raw.city);
  const base = { schemaVersion: JOB_SCHEMA_VERSION, id, canonicalKey: canonicalKey(company, title, location, applicationUrl), title, company, location, employmentType: text(raw.employmentType) ?? text(raw.type), recruitmentType: text(raw.recruitmentType) ?? text(raw.recruitmentType ?? raw.type), category: text(raw.category), salary: text(raw.salary ?? raw.sal), experience: text(raw.experience ?? raw.exp), education: text(raw.education ?? raw.edu), description: text(raw.description), responsibilities: list(raw.responsibilities), requirements: list(raw.requirements), benefits: list(raw.benefits), applicationUrl, sourceUrl, sourceName: text(raw.sourceName ?? raw.src), sourceKind: kind, publishedAt: date(raw.publishedAt ?? raw.pub), firstSeenAt, lastSeenAt, status: status(raw.status), isNew: raw.isNew === true, evidence: [{ kind: kind === "community" ? "community" : "source_snapshot", url: sourceUrl ?? undefined, capturedAt: lastSeenAt } as JobEvidence], raw: { ...raw } } satisfies Omit<NormalizedJob, "quality">;
  return { job: { ...base, quality: qualityOf(base) }, issues };
}

export function normalizeJobs(rawJobs: unknown[], snapshotAt?: string): { jobs: NormalizedJob[]; report: NormalizationReport } {
  const jobs = new Map<string, NormalizedJob>(), issues: NormalizationIssue[] = [];
  let rejected = 0, duplicates = 0;
  for (const raw of rawJobs) {
    const result = normalizeJob((raw && typeof raw === "object" ? raw : {}) as RawJobRecord, snapshotAt);
    issues.push(...result.issues);
    if (!result.job) { rejected += 1; continue; }
    const previous = jobs.get(result.job.canonicalKey);
    if (previous) { duplicates += 1; if (result.job.quality.score > previous.quality.score) jobs.set(result.job.canonicalKey, result.job); continue; }
    jobs.set(result.job.canonicalKey, result.job);
  }
  return { jobs: Array.from(jobs.values()), report: { total: rawJobs.length, accepted: jobs.size, rejected, duplicates, issues } };
}
