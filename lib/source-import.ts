import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getSourceAdapter, type SourceAdapterKey } from "./source-adapters";

const MAX_RESPONSE_BYTES = 1_500_000;
const MAX_JOBS = 300;
const FETCH_TIMEOUT_MS = 15_000;
const BAIDU_API_ORIGIN = "https://talent.baidu.com";
const BAIDU_PAGE_SIZE = 20;
const ALIBABA_PAGE_SIZE = 50;
const MEITUAN_PAGE_SIZE = 50;

export type ImportAttempt = {
  url: string;
  status?: number;
  contentType?: string;
  stage?: string;
  error?: string;
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
};

export type SourceCollectionCursor = {
  page: number;
  updatedAt?: string;
};

export type ImportedJob = {
  title: string;
  company: string;
  location: string;
  description: string;
  applicationUrl: string;
  sourceUrl: string;
  sourceName: string;
  sourceKind: "official_api" | "official_page";
  raw?: Record<string, unknown>;
};

type Source = { company: string; url: string; origin: string; adapterKey: SourceAdapterKey };

const privateIpv4 = (ip: string) => {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && (
    parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
};

const privateIpv6 = (ip: string) => {
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
};

function isPrivateAddress(value: string) {
  const version = isIP(value);
  return version === 4 ? privateIpv4(value) : version === 6 ? privateIpv6(value) : false;
}

export async function validatePublicUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("请输入完整的 http(s) 招聘官网地址"); }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.port) {
    throw new Error("只允许不带账号信息和自定义端口的 http(s) 公网地址");
  }
  if (isPrivateAddress(parsed.hostname)) throw new Error("不允许访问本机、内网或保留地址");
  try {
    const addresses = isIP(parsed.hostname) ? [parsed.hostname] : (await lookup(parsed.hostname, { all: true })).map((item) => item.address);
    if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("目标地址不是可公开访问的公网地址");
  } catch (error) {
    if (error instanceof Error && error.message.includes("公网地址")) throw error;
    throw new Error("无法确认目标地址为公网地址");
  }
  return parsed;
}

function decodeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(value: unknown) {
  return decodeHtml(value).replace(/<br\s*\/?>(\s*)/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s+/g, "\n").trim();
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" / ");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return text(item.name ?? item.value ?? item.label ?? item.text ?? item.content);
  }
  return String(value).replace(/\s+/g, " ").trim();
}

function first(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const result = text(record[key]);
    if (result) return result;
  }
  return "";
}

function walk(value: unknown, visit: (value: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { value.forEach((item) => walk(item, visit)); return; }
  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((item) => walk(item, visit));
}

function normalize(record: Record<string, unknown>, source: Source, method: ImportedJob["sourceKind"]): ImportedJob | null {
  const title = first(record, ["title", "jobTitle", "positionName", "jobName", "name"]);
  if (!title || title.length > 180) return null;
  const organization = record.hiringOrganization;
  const company = typeof organization === "object" && organization ? text((organization as Record<string, unknown>).name) : first(record, ["company", "companyName", "employer", "organization"]);
  const locationValue = record.jobLocation ?? record.location ?? record.locations;
  const location = text(locationValue) || first(record, ["city", "cityName", "workLocation"]);
  const rawUrl = first(record, ["url", "jobUrl", "detailUrl", "link"]);
  let applicationUrl = source.url;
  try { applicationUrl = rawUrl ? new URL(rawUrl, source.url).href : source.url; } catch { /* Keep the source URL. */ }
  return {
    title,
    company: company || source.company,
    location: location || "官网查看",
    description: stripHtml(first(record, ["description", "jobDescription", "responsibility", "responsibilities", "detail", "content"])),
    applicationUrl,
    sourceUrl: source.url,
    sourceName: source.company,
    sourceKind: method,
    raw: record,
  };
}

function unique(jobs: ImportedJob[]) {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = `${job.title}|${job.location}|${job.applicationUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_JOBS);
}

function parseJsonJobs(payload: unknown, source: Source, method: ImportedJob["sourceKind"] = "official_api") {
  const jobs: ImportedJob[] = [];
  walk(payload, (record) => {
    const job = normalize(record, source, method);
    if (job) jobs.push(job);
  });
  return unique(jobs);
}

function parseHtmlJobs(body: string, source: Source) {
  const jobs: ImportedJob[] = [];
  const scripts = /<script[^>]+type=["']application\/(?:ld\+json|json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of body.matchAll(scripts)) {
    try { jobs.push(...parseJsonJobs(JSON.parse(decodeHtml(match[1])), source, "official_page")); } catch { /* Ignore malformed embedded JSON. */ }
  }
  const rss = [] as Array<Record<string, unknown>>;
  for (const match of body.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const block = match[2];
    const field = (name: string) => stripHtml((block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i")) || [])[1]);
    const title = field("title");
    if (title) rss.push({ title, description: field("description") || field("content"), url: field("link"), datePosted: field("pubDate") || field("published") });
  }
  jobs.push(...parseJsonJobs(rss, source, "official_page"));
  return unique(jobs);
}

function isBaiduSource(url: URL) {
  return url.hostname === "talent.baidu.com" || url.hostname === "www.talent.baidu.com";
}

function baiduRecruitType(url: URL) {
  const detailMatch = url.pathname.match(/\/jobs\/detail\/(GRADUATE|INTERN|SOCIAL)\//i);
  const value = detailMatch?.[1] || url.searchParams.get("recruitType") || "GRADUATE";
  return ["GRADUATE", "INTERN", "SOCIAL"].includes(value.toUpperCase()) ? value.toUpperCase() : "GRADUATE";
}

function baiduJob(record: Record<string, unknown>, source: Source, recruitType: string): ImportedJob | null {
  const postId = first(record, ["postId"]);
  const title = first(record, ["name", "title"]);
  if (!postId || !title) return null;
  const detailUrl = `${source.origin}/jobs/detail/${recruitType}/${postId}`;
  const description = [first(record, ["workContent"]), first(record, ["serviceCondition"])].filter(Boolean).join("\n\n");
  return {
    title,
    company: first(record, ["orgName", "companyName"]) || source.company,
    location: first(record, ["workPlace", "location"]),
    description,
    applicationUrl: detailUrl,
    sourceUrl: source.url,
    sourceName: source.company,
    sourceKind: "official_api",
    raw: {
      ...record,
      company: first(record, ["orgName", "companyName"]) || source.company,
      title,
      location: first(record, ["workPlace", "location"]),
      education: first(record, ["education"]),
      experience: first(record, ["workYears"]),
      category: first(record, ["postType"]),
      recruitmentType: first(record, ["projectType"]),
      description,
      applicationUrl: detailUrl,
      sourceUrl: source.url,
      sourceName: source.company,
      sourceKind: "official_api",
    },
  };
}

async function fetchBaiduJson(path: string, attempts: ImportAttempt[], init?: RequestInit) {
  const url = new URL(path, BAIDU_API_ORIGIN);
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": "ORBIT-Qiuzhao-Source-Importer/1.0",
      accept: "application/json",
      referer: "https://talent.baidu.com/jobs/list",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "unknown";
  attempts.push({ url: url.href, status: response.status, contentType, stage: "official-api" });
  if (!response.ok) throw new Error(`百度招聘接口返回 HTTP ${response.status}`);
  const payload = await response.json() as { status?: string; message?: string; data?: unknown };
  if (payload.status !== "ok") throw new Error(payload.message || "百度招聘接口未返回有效数据");
  return payload.data;
}

async function importBaiduSource(source: Source, url: URL, attempts: ImportAttempt[]) {
  const recruitType = baiduRecruitType(url);
  const detailMatch = url.pathname.match(/\/jobs\/detail\/(?:GRADUATE|INTERN|SOCIAL)\/([^/]+)/i);
  if (detailMatch?.[1]) {
    const params = new URLSearchParams({ postId: detailMatch[1], recruitType });
    const detail = await fetchBaiduJson(`/httservice/getPostDetail?${params.toString()}`, attempts);
    const job = detail && typeof detail === "object" ? baiduJob(detail as Record<string, unknown>, source, recruitType) : null;
    return job ? [job] : [];
  }

  const jobs: ImportedJob[] = [];
  const pageSize = Math.min(BAIDU_PAGE_SIZE, MAX_JOBS);
  for (let page = 1; page <= Math.ceil(MAX_JOBS / pageSize); page += 1) {
    const body = new URLSearchParams({
      recruitType,
      pageSize: String(pageSize),
      keyWord: url.searchParams.get("keyWord") || url.searchParams.get("search") || "",
      curPage: String(page),
      projectType: url.searchParams.get("projectType") || "",
    });
    const data = await fetchBaiduJson("/httservice/getPostListNew", attempts, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: body.toString(),
    });
    if (!data || typeof data !== "object") break;
    const pageData = data as { list?: unknown[]; total?: string | number; pageNum?: number };
    for (const item of pageData.list || []) {
      if (item && typeof item === "object") {
        const job = baiduJob(item as Record<string, unknown>, source, recruitType);
        if (job) jobs.push(job);
      }
    }
    const total = Number(pageData.total || 0);
    if (!pageData.list?.length || jobs.length >= Math.min(total || MAX_JOBS, MAX_JOBS) || pageData.list.length < pageSize) break;
  }
  return unique(jobs);
}

function isAlibabaSource(url: URL) {
  return url.hostname === "talent.alibaba.com" || url.hostname === "campus-talent.alibaba.com";
}

function isMeituanSource(url: URL) {
  return url.hostname === "zhaopin.meituan.com";
}

function cookieHeaderFromSetCookie(value: string | null) {
  if (!value) return "";
  return Array.from(value.matchAll(/(?:^|,\s*)(XSRF-TOKEN|SESSION)=([^;]+)/gi))
    .map((match) => `${match[1]}=${match[2]}`)
    .join("; ");
}

function cookieValue(value: string | null, name: string) {
  const match = value?.match(new RegExp(`(?:^|,\\s*|;\\s*)${name}=([^;,]+)`, "i"));
  if (!match?.[1]) return "";
  try { return decodeURIComponent(match[1]); } catch { return match[1]; }
}

async function responseText(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("源站响应超过 1.5 MB 大小限制");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("源站响应超过 1.5 MB 大小限制");
    }
    chunks.push(item.value);
  }
  const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(body);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function alibabaJob(record: Record<string, unknown>, source: Source, origin: string): ImportedJob | null {
  const title = first(record, ["name", "title"]);
  if (!title) return null;
  const positionId = first(record, ["id", "positionId", "code"]);
  const rawUrl = first(record, ["positionUrl", "url", "jobUrl"]);
  let applicationUrl = source.url;
  try {
    applicationUrl = rawUrl ? new URL(rawUrl, origin).href : new URL(`/off-campus/position-detail?lang=zh&positionId=${encodeURIComponent(positionId)}`, origin).href;
  } catch { /* Keep the source URL. */ }
  const location = first(record, ["workLocations", "interviewLocations", "location"]);
  const description = [
    first(record, ["description"]),
    first(record, ["requirement", "requirements"]),
    first(record, ["experience"]),
    first(record, ["degree", "education"]),
  ].filter(Boolean).join("\n\n");
  return normalize({
    ...record,
    title,
    company: source.company,
    location,
    description,
    url: applicationUrl,
    education: first(record, ["degree", "education"]),
    experience: first(record, ["experience"]),
    category: first(record, ["categoryName", "categories"]),
    publishedAt: first(record, ["publishTime"]),
    recruitmentType: first(record, ["batchName", "positionType"]),
    sourceName: source.company,
    sourceUrl: source.url,
    sourceKind: "official_api",
  }, source, "official_api");
}

async function importAlibabaSource(source: Source, url: URL, attempts: ImportAttempt[]) {
  const pageUrl = url.pathname.includes("position-list") ? url : new URL("/off-campus/position-list?lang=zh", url.origin);
  const sessionResponse = await fetch(pageUrl, {
    headers: { "user-agent": "ORBIT-Qiuzhao-Source-Importer/1.0", accept: "text/html,application/xhtml+xml", referer: pageUrl.href },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  attempts.push({ url: pageUrl.href, status: sessionResponse.status, contentType: sessionResponse.headers.get("content-type") || "unknown", stage: "official-api-session" });
  if (!sessionResponse.ok) throw new Error(`阿里招聘页面返回 HTTP ${sessionResponse.status}`);
  await responseText(sessionResponse);

  const setCookie = sessionResponse.headers.get("set-cookie");
  const csrf = cookieValue(setCookie, "XSRF-TOKEN");
  const cookies = cookieHeaderFromSetCookie(setCookie);
  if (!csrf || !cookies) throw new Error("阿里招聘页面未返回可用的会话或 CSRF 信息");

  const jobs: ImportedJob[] = [];
  const pageSize = Math.min(ALIBABA_PAGE_SIZE, MAX_JOBS);
  let total = MAX_JOBS;
  for (let page = 1; page <= Math.ceil(Math.min(total, MAX_JOBS) / pageSize); page += 1) {
    const endpoint = new URL("/position/search", url.origin);
    endpoint.searchParams.set("_csrf", csrf);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "user-agent": "ORBIT-Qiuzhao-Source-Importer/1.0",
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        "x-xsrf-token": csrf,
        cookie: cookies,
        referer: pageUrl.href,
      },
      body: JSON.stringify({
        channel: "group_official_site",
        language: "zh",
        batchId: "",
        categories: "",
        deptCodes: [],
        key: "",
        pageIndex: page,
        pageSize,
        regions: "",
        subCategories: "",
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    attempts.push({ url: endpoint.href, status: response.status, contentType: response.headers.get("content-type") || "unknown", stage: "official-api" });
    if (!response.ok) throw new Error(`阿里招聘接口返回 HTTP ${response.status}`);
    const payload = asRecord(JSON.parse(await responseText(response)));
    if (!payload || payload.success === false) throw new Error(text(payload?.errorMsg) || "阿里招聘接口未返回有效数据");
    const content = asRecord(payload.content);
    const rows = Array.isArray(content?.datas) ? content.datas : [];
    total = Number(content?.totalCount || rows.length || 0);
    for (const row of rows) {
      const job = asRecord(row);
      if (job) {
        const normalized = alibabaJob(job, source, url.origin);
        if (normalized) jobs.push(normalized);
      }
    }
    if (!rows.length || jobs.length >= Math.min(total || MAX_JOBS, MAX_JOBS) || rows.length < pageSize) break;
  }
  return unique(jobs);
}

function meituanJob(record: Record<string, unknown>, source: Source, url: URL): ImportedJob | null {
  const title = first(record, ["name", "title"]);
  if (!title) return null;
  const jobId = first(record, ["jobUnionId", "id"]);
  const highlightType = url.searchParams.get("highlightType") || "campus";
  const applicationUrl = jobId
    ? new URL(`/web/position/detail?jobUnionId=${encodeURIComponent(jobId)}&highlightType=${encodeURIComponent(highlightType)}`, url.origin).href
    : source.url;
  const description = [
    first(record, ["desc", "description"]),
    first(record, ["jobDuty", "responsibilities"]),
    first(record, ["jobRequirement", "requirements"]),
    first(record, ["departmentIntro"]),
  ].filter(Boolean).join("\n\n");
  return normalize({
    ...record,
    title,
    company: source.company,
    location: first(record, ["cityList", "location"]),
    description,
    url: applicationUrl,
    experience: first(record, ["workYear"]),
    category: first(record, ["jobFamily", "jobFamilyGroup"]),
    publishedAt: first(record, ["firstPostTime", "refreshTime"]),
    recruitmentType: first(record, ["jobType", "jobSource"]),
    sourceName: source.company,
    sourceUrl: source.url,
    sourceKind: "official_api",
  }, source, "official_api");
}

async function importMeituanSource(source: Source, url: URL, attempts: ImportAttempt[]) {
  const endpoint = new URL("/api/official/job/getJobList", url.origin);
  const jobs: ImportedJob[] = [];
  const pageSize = Math.min(MEITUAN_PAGE_SIZE, MAX_JOBS);
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "user-agent": "ORBIT-Qiuzhao-Source-Importer/1.0",
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        referer: url.href,
      },
      body: JSON.stringify({
        page: { pageNo: page, pageSize },
        jobShareType: url.searchParams.get("jobShareType") || "1",
        keywords: url.searchParams.get("keywords") || "",
        cityList: [],
        department: [],
        jfJgList: [],
        jobType: [{ code: "1", subCode: [] }, { code: "2", subCode: [] }],
        typeCode: [],
        specialCode: [],
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    attempts.push({ url: endpoint.href, status: response.status, contentType: response.headers.get("content-type") || "unknown", stage: "official-api" });
    if (!response.ok) throw new Error(`美团招聘接口返回 HTTP ${response.status}`);
    const payload = asRecord(JSON.parse(await responseText(response)));
    const data = asRecord(payload?.data);
    if (!payload || !data || payload.status === false) throw new Error(text(payload?.message) || "美团招聘接口未返回有效数据");
    const rows = Array.isArray(data.list) ? data.list : [];
    const pageInfo = asRecord(data.page);
    totalPages = Math.min(Number(pageInfo?.totalPage || 1), Math.ceil(MAX_JOBS / pageSize));
    for (const row of rows) {
      const job = asRecord(row);
      if (job) {
        const normalized = meituanJob(job, source, url);
        if (normalized) jobs.push(normalized);
      }
    }
    if (!rows.length || jobs.length >= MAX_JOBS || rows.length < pageSize) break;
  }
  return unique(jobs);
}

function dynamicAdapterResult(company: string, parsed: URL, adapter: ReturnType<typeof getSourceAdapter>, attempts: ImportAttempt[], error?: unknown) {
  const message = error instanceof Error
    ? `浏览器采集失败：${error.message}`
    : adapter.key === "bytedance-official"
      ? "字节跳动招聘页依赖动态脚本与会话；当前浏览器采集运行时不可用，未把空壳页面误报为成功。"
      : "腾讯招聘页依赖动态脚本与会话；当前浏览器采集运行时不可用，未把空壳页面误报为成功。";
  attempts.push({ url: parsed.href, stage: error ? "browser-render" : "browser-required", error: message });
  return {
    ok: false,
    jobs: [] as ImportedJob[],
    source: { company, url: parsed.href },
    attempts,
    method: error ? "browser-render" : "browser-required",
    adapterKey: adapter.key,
    adapterStatus: adapter.status,
    adapterNote: adapter.note,
    stage: error ? "browser-render" : "browser-required",
    message,
  };
}

async function genericBrowserFallback(company: string, parsed: URL, adapter: ReturnType<typeof getSourceAdapter>, attempts: ImportAttempt[], cursor?: SourceCollectionCursor) {
  try {
    const { importGenericBrowserSource } = await import("./browser-source-import");
    const jobs = await importGenericBrowserSource(company, parsed, attempts);
    return {
      ok: jobs.length > 0,
      jobs,
      source: { company, url: parsed.href },
      attempts,
      method: "generic-browser",
      adapterKey: adapter.key,
      adapterStatus: adapter.status,
      adapterNote: adapter.note,
      stage: jobs.length ? "browser-generic" : "browser-unresolved",
      message: jobs.length
        ? `已通过通用浏览器渲染导入 ${jobs.length} 个岗位`
        : "浏览器已打开招聘页，但未识别到岗位结构；可能需要登录、验证码或人工复核",
    };
  } catch (error) {
    attempts.push({ url: parsed.href, stage: "browser-render", error: error instanceof Error ? error.message : "通用浏览器采集失败" });
    return {
      ok: false,
      jobs: [] as ImportedJob[],
      source: { company, url: parsed.href },
      attempts,
      method: "generic-browser",
      adapterKey: adapter.key,
      adapterStatus: adapter.status,
      adapterNote: adapter.note,
      stage: "browser-render",
      message: error instanceof Error ? `通用浏览器采集失败：${error.message}` : "通用浏览器采集失败",
    };
  }
}

async function readResponse(url: URL, attempts: ImportAttempt[]) {
  const response = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": "ORBIT-Qiuzhao-Source-Importer/1.0", accept: "application/json,application/rss+xml,application/atom+xml,text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "unknown";
  attempts.push({ url: url.href, status: response.status, contentType });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error(`来源返回了无目标的重定向（HTTP ${response.status}）`);
    const next = await validatePublicUrl(new URL(location, url).href);
    return readResponse(next, attempts);
  }
  if (!response.ok) throw new Error(`来源返回 HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("来源响应超过 1.5 MB 大小限制");
  if (!response.body) return { body: "", contentType };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("来源响应超过 1.5 MB 大小限制"); }
    chunks.push(item.value);
  }
  const body = new TextDecoder().decode(chunks.reduce((all, chunk) => { const next = new Uint8Array(all.length + chunk.length); next.set(all); next.set(chunk, all.length); return next; }, new Uint8Array()));
  return { body, contentType };
}

export async function importSource(company: string, url: string, options: { cursor?: SourceCollectionCursor } = {}) {
  const parsed = await validatePublicUrl(url);
  const adapter = getSourceAdapter(parsed);
  const source: Source = { company, url: parsed.href, origin: parsed.origin, adapterKey: adapter.key };
  const attempts: ImportAttempt[] = [];
  const shouldUseGenericBrowser = adapter.key === "generic-public" || adapter.status === "planned";
  if (isBaiduSource(parsed)) {
    try {
      const jobs = await importBaiduSource(source, parsed, attempts);
      return {
        ok: jobs.length > 0,
        jobs,
        source: { company, url: parsed.href },
        attempts,
        method: "official-baidu-api",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: jobs.length ? "official-api" : "unresolved",
        message: jobs.length ? `已通过百度官方接口导入 ${jobs.length} 个岗位` : "百度官方接口未返回可识别岗位数据",
      };
    } catch (error) {
      attempts.push({ url: parsed.href, stage: "official-api", error: error instanceof Error ? error.message : "百度官方接口调用失败" });
    }
  }
  if (adapter.status === "experimental") {
    try {
      const { importDynamicBrowserSource } = await import("./browser-source-import");
      const jobs = await importDynamicBrowserSource(company, parsed, attempts, options.cursor);
      return {
        ok: jobs.length > 0,
        jobs,
        source: { company, url: parsed.href },
        attempts,
        method: "official-browser",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: jobs.length ? "browser-render" : "browser-unresolved",
        message: jobs.length ? `已通过浏览器动态渲染导入 ${jobs.length} 个岗位` : "浏览器已打开招聘页，但未识别到岗位卡片；可能需要登录、验证码或人工复核",
      };
    } catch (error) {
      return dynamicAdapterResult(company, parsed, adapter, attempts, error);
    }
  }
  if (isAlibabaSource(parsed)) {
    try {
      const jobs = await importAlibabaSource(source, parsed, attempts);
      return {
        ok: jobs.length > 0,
        jobs,
        source: { company, url: parsed.href },
        attempts,
        method: "official-alibaba-api",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: jobs.length ? "official-api" : "unresolved",
        message: jobs.length ? `已通过阿里官方接口导入 ${jobs.length} 个岗位` : "阿里官方接口未返回可识别岗位数据",
      };
    } catch (error) {
      attempts.push({ url: parsed.href, stage: "official-api", error: error instanceof Error ? error.message : "阿里官方接口调用失败" });
      return {
        ok: false,
        jobs: [] as ImportedJob[],
        source: { company, url: parsed.href },
        attempts,
        method: "official-alibaba-api",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: "official-api",
        message: error instanceof Error ? error.message : "阿里官方接口调用失败",
      };
    }
  }
  if (isMeituanSource(parsed)) {
    try {
      const jobs = await importMeituanSource(source, parsed, attempts);
      return {
        ok: jobs.length > 0,
        jobs,
        source: { company, url: parsed.href },
        attempts,
        method: "official-meituan-api",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: jobs.length ? "official-api" : "unresolved",
        message: jobs.length ? `已通过美团官方接口导入 ${jobs.length} 个岗位` : "美团官方接口未返回可识别岗位数据",
      };
    } catch (error) {
      attempts.push({ url: parsed.href, stage: "official-api", error: error instanceof Error ? error.message : "美团官方接口调用失败" });
      return {
        ok: false,
        jobs: [] as ImportedJob[],
        source: { company, url: parsed.href },
        attempts,
        method: "official-meituan-api",
        adapterKey: adapter.key,
        adapterStatus: adapter.status,
        adapterNote: adapter.note,
        stage: "official-api",
        message: error instanceof Error ? error.message : "美团官方接口调用失败",
      };
    }
  }
  let payload: { body: string; contentType: string };
  try {
    payload = await readResponse(parsed, attempts);
  } catch (error) {
    if (shouldUseGenericBrowser) return genericBrowserFallback(company, parsed, adapter, attempts, options.cursor);
    throw error;
  }
  const trimmed = payload.body.trim().replace(/^\uFEFF/, "").replace(/^\)\]\}',?\s*/, "");
  let jobs: ImportedJob[] = [];
  if (/json/i.test(payload.contentType) || /^[\[{]/.test(trimmed)) {
    try { jobs = parseJsonJobs(JSON.parse(trimmed), source); } catch { /* Fall through to HTML parsing. */ }
  }
  if (!jobs.length && (/<(?:html|script|item|entry)\b/i.test(trimmed) || /html|xml/i.test(payload.contentType))) jobs = parseHtmlJobs(trimmed, source);
  if (!jobs.length && shouldUseGenericBrowser) return genericBrowserFallback(company, parsed, adapter, attempts, options.cursor);
  return {
    ok: jobs.length > 0,
    jobs,
    source: { company, url: parsed.href },
    attempts,
    method: jobs[0]?.sourceKind === "official_api" ? "official-json" : "official-html",
    adapterKey: adapter.key,
    adapterStatus: adapter.status,
    adapterNote: adapter.note,
    stage: jobs.length ? "structured-data" : "unresolved",
    message: jobs.length ? `已导入 ${jobs.length} 个岗位` : "页面未发现可识别的公开岗位数据；请提供岗位列表、公开 JSON/RSS 或可访问的招聘入口",
  };
}

export { MAX_RESPONSE_BYTES, FETCH_TIMEOUT_MS };
