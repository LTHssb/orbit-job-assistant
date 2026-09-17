import mammoth from "mammoth";
import { createSupabaseAdminClient } from "./admin";

export type ResumeAnalysis = {
  summary: string;
  targetRoles: string[];
  skills: string[];
  strengths: string[];
  gaps: string[];
  suggestions: string[];
  education: string[];
  experiences: string[];
  score: number;
};

type AnalyzeResult =
  | { ok: true; documentId: string; status: "ready"; analysis: ResumeAnalysis }
  | { ok: false; documentId: string; status: "failed"; message: string };

function parseModelJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回内容不是有效 JSON");
  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean).slice(0, 30) : [];
}

function normalizeAnalysis(value: Record<string, unknown>): ResumeAnalysis {
  const score = typeof value.score === "number" && Number.isFinite(value.score) ? Math.max(0, Math.min(100, Math.round(value.score))) : 0;
  return {
    summary: stringValue(value.summary),
    targetRoles: stringArray(value.targetRoles),
    skills: stringArray(value.skills),
    strengths: stringArray(value.strengths),
    gaps: stringArray(value.gaps),
    suggestions: stringArray(value.suggestions),
    education: stringArray(value.education),
    experiences: stringArray(value.experiences),
    score,
  };
}

async function extractText(mimeType: string, bytes: ArrayBuffer) {
  const buffer = Buffer.from(bytes);
  if (mimeType === "application/pdf") {
    // pdf-parse/pdfjs expects browser canvas globals even when it runs in Node.
    // Load the native Node canvas first so the module can initialize safely on Vercel.
    const canvas = await import("@napi-rs/canvas");
    const runtime = globalThis as Record<string, unknown>;
    runtime.DOMMatrix ??= canvas.DOMMatrix;
    runtime.ImageData ??= canvas.ImageData;
    runtime.Path2D ??= canvas.Path2D;
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const parsed = await parser.getText();
      return parsed.text.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").trim();
    } finally {
      await parser.destroy();
    }
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value.replace(/\u0000/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }
  throw new Error("DOC 格式暂不支持自动提取；文件已安全保存，可改用 PDF 或 DOCX。 ");
}

async function markFailed(admin: ReturnType<typeof createSupabaseAdminClient>, documentId: string, message: string): Promise<AnalyzeResult> {
  if (admin) await admin.from("resume_documents").update({ status: "failed", parser_error: message, updated_at: new Date().toISOString() }).eq("id", documentId);
  return { ok: false, documentId, status: "failed", message };
}

export async function analyzeStoredResume(userId: string, documentId: string): Promise<AnalyzeResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { ok: false, documentId, status: "failed", message: "文件服务暂未配置。" };
  const document = await admin.from("resume_documents").select("id,storage_path,mime_type,status").eq("id", documentId).eq("user_id", userId).maybeSingle();
  if (document.error || !document.data) return { ok: false, documentId, status: "failed", message: "找不到这份简历，可能已被删除。" };

  await admin.from("resume_documents").update({ status: "parsing", parser_error: null, updated_at: new Date().toISOString() }).eq("id", documentId).eq("user_id", userId);
  const download = await admin.storage.from("resumes").download(document.data.storage_path);
  if (download.error || !download.data) return markFailed(admin, documentId, "私有文件读取失败，请重新上传。 ");

  let extractedText = "";
  try {
    extractedText = await extractText(document.data.mime_type, await download.data.arrayBuffer());
  } catch (error) {
    return markFailed(admin, documentId, error instanceof Error ? error.message : "简历文本提取失败。 ");
  }
  if (extractedText.length < 20) return markFailed(admin, documentId, "没有识别到足够的文字；如果是扫描件，请先进行 OCR。 ");

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return markFailed(admin, documentId, "尚未配置 DeepSeek 服务端密钥，文件已保存。 ");
  const sourceText = extractedText.slice(0, 60_000);
  const prompt = `你是简历结构化分析引擎。只返回 JSON，不要 Markdown，不要补猜原文没有的信息。请分析以下简历，输出：
{
  "summary": "一句话职业画像",
  "targetRoles": ["适合的目标岗位，最多 5 个"],
  "skills": ["明确出现的技能，最多 20 个"],
  "strengths": ["基于原文的优势，最多 5 条"],
  "gaps": ["与目标岗位相关但材料不足的点，最多 5 条"],
  "suggestions": ["可执行的修改建议，最多 5 条"],
  "education": ["教育经历摘要"],
  "experiences": ["实习/项目经历摘要"],
  "score": 0
}
score 为 0 到 100 的简历表达完成度，不代表录用概率。

简历文本：
${sourceText}`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-pro",
        temperature: 0.1,
        max_tokens: 3000,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: "你只输出合法 JSON，不要输出 Markdown 或解释文字。" }, { role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) return markFailed(admin, documentId, payload.error?.message || `DeepSeek 请求失败（HTTP ${response.status}）。`);
    const content = payload.choices?.[0]?.message?.content || "";
    if (!content.trim()) return markFailed(admin, documentId, "DeepSeek 返回为空，请稍后重试。 ");
    const analysis = normalizeAnalysis(parseModelJson(content));
    const saved = await admin.from("resume_documents").update({ status: "ready", extracted_text: extractedText, analysis, parser_error: null, updated_at: new Date().toISOString() }).eq("id", documentId).eq("user_id", userId).select("id").maybeSingle();
    if (saved.error || !saved.data) return markFailed(admin, documentId, "AI 结果保存失败，请稍后重试。 ");
    return { ok: true, documentId, status: "ready", analysis };
  } catch (error) {
    return markFailed(admin, documentId, error instanceof Error ? error.message : "简历 AI 分析失败。 ");
  }
}
