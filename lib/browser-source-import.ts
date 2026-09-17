import type { ImportedJob, ImportAttempt, SourceCollectionCursor } from "./source-import";
import { createSupabaseAdminClient } from "./supabase/admin";

const MAX_JOBS = 300;
const MAX_PAGES = 30;
const BROWSER_TIMEOUT_MS = 35_000;
const PAGINATION_WAIT_MS = 1_200;

type DynamicSource = { company: string; url: string };
type ByteDanceListPayload = {
  code?: number;
  data?: {
    count?: number;
    job_post_list?: Array<Record<string, unknown>>;
  };
};

const cityNames = ["北京", "上海", "深圳", "广州", "杭州", "成都", "南京", "武汉", "西安", "苏州", "合肥", "重庆", "香港", "澳门", "全国", "海外"];

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function cities(value: string) {
  return unique(cityNames.filter((city) => value.includes(city))).join(" / ");
}

function fieldFrom(text: string, patterns: RegExp[]) {
  return patterns.map((pattern) => text.match(pattern)?.[0] || "").find(Boolean) || "";
}

function labelFrom(value: unknown): string {
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return unique(value.map(labelFrom)).join(" / ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return labelFrom(record.i18n_name ?? record.name ?? record.title ?? record.display_name ?? record.city_name);
  }
  return "";
}

function browserJob(input: {
  title: string;
  body: string;
  applicationUrl: string;
  source: DynamicSource;
  category?: string;
  location?: string;
  recruitmentType?: string;
}): ImportedJob | null {
  const title = clean(input.title);
  if (!title || title.length > 180) return null;
  const body = clean(input.body).slice(0, 18_000);
  const location = clean(input.location) || cities(body) || "官网查看";
  const recruitmentType = clean(input.recruitmentType) || fieldFrom(body, [/\d{4}届[^ ]{0,20}/, /日常实习/, /前沿技术领域人才实习招聘/, /正式/, /实习/]) || "官方岗位";
  const category = clean(input.category) || fieldFrom(body, [/研发[^ ]{0,12}/, /运营[^ ]{0,12}/, /产品[^ ]{0,12}/, /设计[^ ]{0,12}/, /市场[^ ]{0,12}/, /销售[^ ]{0,12}/]) || "官网查看";
  return {
    title,
    company: input.source.company,
    location,
    description: body || "官网已发现该职位，完整 JD 请通过官网链接查看。",
    applicationUrl: input.applicationUrl,
    sourceUrl: input.source.url,
    sourceName: input.source.company,
    sourceKind: "official_page",
    raw: {
      title,
      company: input.source.company,
      location,
      description: body,
      url: input.applicationUrl,
      applicationUrl: input.applicationUrl,
      sourceUrl: input.source.url,
      sourceName: input.source.company,
      sourceKind: "official_page",
      category,
      recruitmentType,
      experience: recruitmentType,
      browserCapture: true,
      capturedAt: new Date().toISOString(),
    },
  };
}

async function loadBrowserEngine() {
  const playwrightModule = await import("playwright-core");
  const { default: chromiumRuntime } = await import("@sparticuz/chromium");
  return {
    chromium: playwrightModule.chromium,
    launchOptions: {
      args: chromiumRuntime.args,
      executablePath: await chromiumRuntime.executablePath(),
      headless: true,
    },
  };
}

async function captureBrowserScreenshot(page: import("playwright-core").Page, source: DynamicSource) {
  const client = createSupabaseAdminClient();
  if (!client) return "";
  const bucket = "job-evidence";
  await client.storage.createBucket(bucket, { public: true }).catch(() => undefined);
  const path = `sources/${stableHash(`${source.company}|${source.url}`)}/latest.png`;
  const image = await page.screenshot({ type: "png" });
  const upload = await client.storage.from(bucket).upload(path, image, {
    contentType: "image/png",
    upsert: true,
  });
  if (upload.error) return "";
  return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

async function collectByteDance(page: import("playwright-core").Page, source: DynamicSource, parsed: URL) {
  const target = parsed.pathname.includes("/campus/position") && !parsed.pathname.endsWith("/detail")
    ? parsed.href
    : new URL("/campus/position", parsed.origin).href;
  if (target !== parsed.href) await page.goto(target, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("a")).some((node) => /\/campus\/position\/\d+\/detail/.test(node.getAttribute("href") || "")),
    undefined,
    { timeout: 15_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(1500);
  const jobs: ImportedJob[] = [];
  const anchors = await page.locator("a").all();
  for (const anchor of anchors) {
    const href = await anchor.getAttribute("href").catch(() => null);
    if (!href || !/\/campus\/position\/\d+\/detail/.test(href)) continue;
    const body = clean(await anchor.innerText().catch(() => ""));
    const lines = body.split(/\s{2,}|\n/).map(clean).filter(Boolean);
    const title = lines[0] || body.slice(0, 100);
    const applicationUrl = new URL(href, parsed.origin).href;
    const job = browserJob({
      title,
      body,
      applicationUrl,
      source,
      location: cities(body),
      category: fieldFrom(body, [/研发[^ ]{0,12}/, /运营[^ ]{0,12}/, /产品[^ ]{0,12}/, /设计[^ ]{0,12}/]),
      recruitmentType: fieldFrom(body, [/\d{4}届[^ ]{0,20}/, /日常实习/, /正式/, /实习/]),
    });
    if (job) jobs.push(job);
    if (jobs.length >= MAX_JOBS) break;
  }
  return { jobs, target };
}

async function collectByteDancePage(page: import("playwright-core").Page, source: DynamicSource, parsed: URL) {
  const jobs: ImportedJob[] = [];
  const anchors = await page.locator("a").all();
  for (const anchor of anchors) {
    const href = await anchor.getAttribute("href").catch(() => null);
    if (!href || !/\/campus\/position\/\d+\/detail/.test(href)) continue;
    const body = clean(await anchor.innerText().catch(() => ""));
    const lines = body.split(/\s{2,}|\n/).map(clean).filter(Boolean);
    const title = lines[0] || body.slice(0, 100);
    const job = browserJob({
      title,
      body,
      applicationUrl: new URL(href, parsed.origin).href,
      source,
      location: cities(body),
    });
    if (job) jobs.push(job);
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

function collectByteDanceApi(payload: ByteDanceListPayload, source: DynamicSource, parsed: URL) {
  const list = payload.data?.job_post_list || [];
  const jobs: ImportedJob[] = [];
  for (const item of list) {
    const id = clean(item.id ?? item.job_id ?? item.post_id);
    const title = clean(item.title ?? item.name);
    if (!id || !title) continue;
    const detailUrl = new URL(`/campus/position/${id}/detail`, parsed.origin).href;
    const info = item.job_post_info && typeof item.job_post_info === "object"
      ? item.job_post_info as Record<string, unknown>
      : {};
    const body = [
      clean(item.sub_title),
      clean(item.description),
      clean(item.requirement),
      labelFrom(item.recruit_type),
      labelFrom(item.job_category),
    ].filter(Boolean).join("\n");
    const job = browserJob({
      title,
      body,
      applicationUrl: detailUrl,
      source,
      location: labelFrom(item.city_info) || labelFrom(item.city_list) || labelFrom(item.city_info_list_for_delivery) || cities(body),
      category: labelFrom(item.job_category) || labelFrom(item.job_function),
      recruitmentType: labelFrom(item.recruit_type) || clean(info.experience),
    });
    if (job) {
      job.raw = { ...job.raw, officialApi: item, officialCount: payload.data?.count };
      jobs.push(job);
    }
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

function addUniqueJobs(target: ImportedJob[], candidates: ImportedJob[]) {
  const seen = new Set(target.map((job) => job.applicationUrl));
  for (const job of candidates) {
    if (seen.has(job.applicationUrl)) continue;
    seen.add(job.applicationUrl);
    target.push(job);
    if (target.length >= MAX_JOBS) break;
  }
}

const genericJobPath = /(?:job|jobs|position|post|career|recruit|campus|graduate|intern|招聘|职位|岗位|校招)/i;
const genericNoise = /(?:登录|注册|隐私|协议|帮助|联系我们|关于我们|首页|搜索|筛选|上一页|下一页|查看更多|more|login|sign\s*up|privacy|contact|home)/i;

function walkGenericRecords(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkGenericRecords(item, visit));
    return;
  }
  const record = value as Record<string, unknown>;
  visit(record);
  Object.values(record).forEach((item) => walkGenericRecords(item, visit));
}

function resolvedUrl(value: unknown, fallback: string) {
  const candidate = labelFrom(value);
  if (!candidate) return fallback;
  try { return new URL(candidate, fallback).href; } catch { return fallback; }
}

function genericTitle(raw: string) {
  const lines = raw.split(/\r?\n|\s{2,}/).map(clean).filter(Boolean);
  return lines.find((line) => line.length >= 4 && line.length <= 140 && !genericNoise.test(line)) || lines[0] || clean(raw).slice(0, 140);
}

function genericStructuredJobs(payload: unknown, source: DynamicSource, parsed: URL) {
  const jobs: ImportedJob[] = [];
  walkGenericRecords(payload, (record) => {
    const type = labelFrom(record["@type"]);
    const title = clean(record.title ?? record.jobTitle ?? "");
    const isJobPosting = /jobposting/i.test(type) || Boolean(record.jobLocation || record.hiringOrganization || record.baseSalary);
    if (!isJobPosting || !title) return;
    const body = [
      clean(record.description),
      clean(record.responsibilities),
      clean(record.qualifications),
      clean(record.experienceRequirements),
    ].filter(Boolean).join("\n");
    const job = browserJob({
      title,
      body,
      applicationUrl: resolvedUrl(record.url ?? record.sameAs, parsed.href),
      source,
      location: labelFrom(record.jobLocation ?? record.location),
      category: labelFrom(record.occupationalCategory ?? record.category),
      recruitmentType: labelFrom(record.employmentType ?? record.jobType),
    });
    if (job) jobs.push(job);
  });
  return jobs;
}

async function collectGenericPage(page: import("playwright-core").Page, source: DynamicSource, parsed: URL) {
  await page.waitForTimeout(1800);
  const jobs: ImportedJob[] = [];
  const scripts = await page.locator('script[type="application/ld+json"], script[type="application/json"]').allTextContents().catch(() => []);
  for (const script of scripts) {
    try { addUniqueJobs(jobs, genericStructuredJobs(JSON.parse(script), source, parsed)); } catch { /* Ignore malformed or non-job JSON. */ }
    if (jobs.length >= MAX_JOBS) return jobs;
  }

  const anchors = await page.locator("a[href]").all().catch(() => []);
  for (const anchor of anchors.slice(0, 400)) {
    const href = await anchor.getAttribute("href").catch(() => null);
    const raw = await anchor.innerText().catch(() => "");
    const body = clean(raw);
    if (!href || body.length < 12 || body.length > 1200 || !genericJobPath.test(href) || genericNoise.test(body)) continue;
    const applicationUrl = resolvedUrl(href, parsed.href);
    const job = browserJob({ title: genericTitle(raw), body, applicationUrl, source });
    if (job) addUniqueJobs(jobs, [job]);
    if (jobs.length >= MAX_JOBS) return jobs;
  }

  const cards = await page.locator("article, li, [role='listitem'], [class*='job'], [class*='position'], [class*='career'], [class*='recruit']").all().catch(() => []);
  for (const card of cards.slice(0, 500)) {
    const raw = await card.innerText().catch(() => "");
    const body = clean(raw);
    const className = await card.getAttribute("class").catch(() => "") || "";
    if (body.length < 16 || body.length > 1200 || genericNoise.test(body)) continue;
    const detailLinks = await card.locator("a[href]").all().catch(() => []);
    const href = detailLinks.length ? await detailLinks[0].getAttribute("href").catch(() => null) : null;
    if (!href && !genericJobPath.test(className)) continue;
    const job = browserJob({
      title: genericTitle(raw),
      body,
      applicationUrl: resolvedUrl(href, parsed.href),
      source,
    });
    if (job) addUniqueJobs(jobs, [job]);
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

export async function importGenericBrowserSource(company: string, parsed: URL, attempts: ImportAttempt[]) {
  const source: DynamicSource = { company, url: parsed.href };
  const engine = await loadBrowserEngine();
  let browser: Awaited<ReturnType<typeof engine.chromium.launch>> | null = null;
  try {
    browser = await engine.chromium.launch({ ...engine.launchOptions, timeout: BROWSER_TIMEOUT_MS });
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    const response = await page.goto(parsed.href, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
    attempts.push({ url: parsed.href, status: response?.status() || 200, stage: "browser-render", contentType: response?.headers()["content-type"] || "text/html" });
    const jobs = await collectGenericPage(page, source, parsed);
    const screenshotUrl = await captureBrowserScreenshot(page, source).catch(() => "");
    if (screenshotUrl) attempts.push({ url: parsed.href, status: 200, stage: "browser-screenshot", contentType: "image/png", screenshotUrl });
    attempts.push({
      url: parsed.href,
      status: response?.status() || 200,
      stage: "browser-generic",
      contentType: "text/html",
      metadata: { strategy: "jsonld-link-card", jobs: jobs.length },
    });
    return jobs;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

async function collectTencentPage(page: import("playwright-core").Page, source: DynamicSource, target: string) {
  const jobs: ImportedJob[] = [];
  const cards = await page.locator("li.post_box").all();
  for (const card of cards) {
    const title = clean(await card.locator(".post_title").innerText().catch(() => ""));
    const body = clean(await card.innerText().catch(() => ""));
    const tags = (await card.locator(".post_tag").allTextContents().catch(() => [])).map(clean);
    const location = clean(await card.locator(".site").innerText().catch(() => "")) || cities(body);
    const applicationUrl = `${target}#job-${stableHash(`${title}|${location}|${body}`)}`;
    const job = browserJob({
      title,
      body,
      applicationUrl,
      source,
      location,
      category: tags[0],
      recruitmentType: tags[1] || fieldFrom(body, [/\u5e94\u5c4a\u6bd5\u4e1a\u751f/, /\u5b9e\u4e60\u751f/, /\u5b9e\u4e60/]),
    });
    if (job) jobs.push(job);
    if (jobs.length >= MAX_JOBS) break;
  }
  return jobs;
}

async function collectTencent(page: import("playwright-core").Page, source: DynamicSource, parsed: URL) {
  const target = new URL("/post.html", parsed.origin).href;
  if (parsed.href !== target) await page.goto(target, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
  await page.waitForTimeout(2500);
  const jobs: ImportedJob[] = [];
  const cards = await page.locator("li.post_box").all();
  for (const card of cards) {
    const title = clean(await card.locator(".post_title").innerText().catch(() => ""));
    const body = clean(await card.innerText().catch(() => ""));
    const tags = (await card.locator(".post_tag").allTextContents().catch(() => [])).map(clean);
    const location = clean(await card.locator(".site").innerText().catch(() => "")) || cities(body);
    const applicationUrl = `${target}#job-${stableHash(`${title}|${location}|${body}`)}`;
    const job = browserJob({
      title,
      body,
      applicationUrl,
      source,
      location,
      category: tags[0],
      recruitmentType: tags[1] || fieldFrom(body, [/应届毕业生/, /实习生/, /实习/]),
    });
    if (job) jobs.push(job);
    if (jobs.length >= MAX_JOBS) break;
  }
  return { jobs, target };
}

type ByteDancePayloadState = { payload: ByteDanceListPayload | null; version: number };

async function waitForByteDancePayload(
  page: import("playwright-core").Page,
  getState: () => ByteDancePayloadState,
  previousVersion: number,
) {
  let state = getState();
  for (let index = 0; index < 25 && state.version <= previousVersion; index += 1) {
    await page.waitForTimeout(300);
    state = getState();
  }
  return state;
}

async function collectByteDancePages(
  page: import("playwright-core").Page,
  source: DynamicSource,
  parsed: URL,
  initial: { jobs: ImportedJob[]; target: string },
  getState: () => ByteDancePayloadState,
  cursor?: SourceCollectionCursor,
) {
  const jobs: ImportedJob[] = [];
  const startPage = Math.max(1, Math.floor(cursor?.page || 1));
  let currentPage = 1;
  let state = await waitForByteDancePayload(page, getState, 0);
  let exhausted = false;
  while (currentPage < startPage) {
    const next = page.locator("li.atsx-pagination-next").first();
    if (!(await next.count())) { exhausted = true; break; }
    const nextClass = await next.getAttribute("class").catch(() => "");
    if (nextClass?.includes("disabled")) { exhausted = true; break; }
    const beforeVersion = getState().version;
    try { await next.click({ timeout: BROWSER_TIMEOUT_MS }); } catch { exhausted = true; break; }
    state = await waitForByteDancePayload(page, getState, beforeVersion);
    if (state.version <= beforeVersion) { exhausted = true; break; }
    currentPage += 1;
  }
  const initialState = state;
  const total = initialState.payload?.data?.count || 0;
  const pageLimit = Math.min(startPage + MAX_PAGES - 1, total ? Math.ceil(total / 10) : startPage + MAX_PAGES - 1);
  if (!exhausted && initialState.payload) addUniqueJobs(jobs, collectByteDanceApi(initialState.payload, source, parsed));
  else if (!exhausted && currentPage === 1) addUniqueJobs(jobs, initial.jobs);
  else if (!exhausted) addUniqueJobs(jobs, await collectByteDancePage(page, source, parsed));

  let pages = 1;
  while (!exhausted && jobs.length < MAX_JOBS && currentPage < pageLimit) {
    const next = page.locator("li.atsx-pagination-next").first();
    if (!(await next.count())) { exhausted = true; break; }
    const nextClass = await next.getAttribute("class").catch(() => "");
    if (nextClass?.includes("disabled")) { exhausted = true; break; }
    const beforeVersion = getState().version;
    const beforeCount = jobs.length;
    try {
      await next.click({ timeout: BROWSER_TIMEOUT_MS });
    } catch { exhausted = true; break; }
    state = await waitForByteDancePayload(page, getState, beforeVersion);
    if (state.payload && state.version > beforeVersion) {
      addUniqueJobs(jobs, collectByteDanceApi(state.payload, source, parsed));
    } else {
      await page.waitForTimeout(PAGINATION_WAIT_MS);
      addUniqueJobs(jobs, await collectByteDancePage(page, source, parsed));
    }
    currentPage += 1;
    pages += 1;
    if (jobs.length === beforeCount && state.version <= beforeVersion) { exhausted = true; break; }
  }
  return { jobs, target: initial.target, pages, total, startPage, nextPage: exhausted ? 1 : currentPage + 1, exhausted };
}

async function collectTencentPages(
  page: import("playwright-core").Page,
  source: DynamicSource,
  initial: { jobs: ImportedJob[]; target: string },
  cursor?: SourceCollectionCursor,
) {
  const jobs: ImportedJob[] = [];
  const startPage = Math.max(1, Math.floor(cursor?.page || 1));
  let currentPage = 1;
  let exhausted = false;
  while (currentPage < startPage) {
    const next = page.locator("button.btn-next").first();
    if (!(await next.count())) { exhausted = true; break; }
    const disabled = await next.getAttribute("disabled").catch(() => null);
    if (disabled !== null) { exhausted = true; break; }
    try { await next.click({ timeout: BROWSER_TIMEOUT_MS }); } catch { exhausted = true; break; }
    await page.waitForTimeout(PAGINATION_WAIT_MS);
    currentPage += 1;
  }
  if (!exhausted && currentPage === 1) addUniqueJobs(jobs, initial.jobs);
  else if (!exhausted) addUniqueJobs(jobs, await collectTencentPage(page, source, initial.target));
  let pages = 1;
  while (!exhausted && jobs.length < MAX_JOBS && pages < MAX_PAGES) {
    const next = page.locator("button.btn-next").first();
    if (!(await next.count())) { exhausted = true; break; }
    const disabled = await next.getAttribute("disabled").catch(() => null);
    if (disabled !== null) { exhausted = true; break; }
    const beforeCount = jobs.length;
    try {
      await next.click({ timeout: BROWSER_TIMEOUT_MS });
    } catch { exhausted = true; break; }
    await page.waitForTimeout(PAGINATION_WAIT_MS);
    addUniqueJobs(jobs, await collectTencentPage(page, source, initial.target));
    currentPage += 1;
    pages += 1;
    if (jobs.length === beforeCount) { exhausted = true; break; }
  }
  return { jobs, target: initial.target, pages, startPage, nextPage: exhausted ? 1 : currentPage + 1, exhausted };
}

export async function importDynamicBrowserSource(company: string, parsed: URL, attempts: ImportAttempt[], cursor?: SourceCollectionCursor) {
  const source: DynamicSource = { company, url: parsed.href };
  const engine = await loadBrowserEngine();
  let browser: Awaited<ReturnType<typeof engine.chromium.launch>> | null = null;
  try {
    browser = await engine.chromium.launch({ ...engine.launchOptions, timeout: BROWSER_TIMEOUT_MS });
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    const page = await context.newPage();
    const listApiResponses: string[] = [];
    const listApiSummaries: string[] = [];
    let byteDanceListPayload: ByteDanceListPayload | null = null;
    let byteDancePayloadVersion = 0;
    page.on("response", (response) => {
      if (/\/api\/v1\/search\/job\/posts\/?/.test(response.url())) {
        listApiResponses.push(`${response.status()} ${response.headers()["content-type"] || ""}`.trim());
        void response.text().then((body) => {
          try {
            const payload = JSON.parse(body) as ByteDanceListPayload & { message?: string; msg?: string };
            if (payload.data?.job_post_list?.length) {
              byteDanceListPayload = payload;
              byteDancePayloadVersion += 1;
            }
            listApiSummaries.push(`code=${payload.code ?? ""}; count=${payload.data?.count ?? ""}; list=${payload.data?.job_post_list?.length ?? 0}; message=${payload.message || payload.msg || ""}`);
          } catch {
            listApiSummaries.push(`body=${clean(body).slice(0, 120)}`);
          }
        }).catch(() => undefined);
      }
    });
    const initial = parsed.href;
    await page.goto(initial, { waitUntil: "domcontentloaded", timeout: BROWSER_TIMEOUT_MS });
    attempts.push({ url: initial, status: 200, stage: "browser-render", contentType: "text/html" });
    let result: { jobs: ImportedJob[]; target: string; pages?: number; total?: number; startPage?: number; nextPage?: number; exhausted?: boolean } = parsed.hostname === "jobs.bytedance.com"
      ? await collectByteDance(page, source, parsed)
      : await collectTencent(page, source, parsed);
    const screenshotUrl = await captureBrowserScreenshot(page, source).catch(() => "");
    if (screenshotUrl) attempts.push({ url: result.target, status: 200, stage: "browser-screenshot", contentType: "image/png", screenshotUrl });
    if (parsed.hostname === "jobs.bytedance.com") {
      result = await collectByteDancePages(page, source, parsed, result, () => ({ payload: byteDanceListPayload, version: byteDancePayloadVersion }), cursor);
    } else {
      result = await collectTencentPages(page, source, result, cursor);
    }
    attempts.push({
      url: result.target,
      status: 200,
      stage: (result.pages ?? 1) > 1 ? "browser-pagination" : "browser-render",
      contentType: "text/html",
      metadata: {
        startPage: result.startPage ?? 1,
        pages: result.pages ?? 1,
        nextPage: result.nextPage ?? 1,
        exhausted: Boolean(result.exhausted),
        total: result.total ?? null,
      },
      error: parsed.hostname === "jobs.bytedance.com" && !result.jobs.length
          ? listApiResponses.length
          ? `岗位列表接口响应：${listApiResponses.join(", ")}${listApiSummaries.length ? `；${listApiSummaries.join("；")}` : ""}`
          : "岗位列表接口未返回响应"
        : undefined,
    });
    return result.jobs;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
