import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_INPUT = 60_000;

function parseModelJson(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? value;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("DeepSeek 返回内容不是有效 JSON");
  return JSON.parse(fenced.slice(start, end + 1)) as Record<string, unknown>;
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, message: "请求内容必须是合法 JSON" }, { status: 400 }); }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) return NextResponse.json({ ok: false, message: "请提供需要识别的 JD 文本" }, { status: 422 });
  if (text.length > MAX_INPUT) return NextResponse.json({ ok: false, message: `JD 文本不能超过 ${MAX_INPUT} 个字符` }, { status: 422 });
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ ok: false, message: "尚未配置 DeepSeek 服务端密钥" }, { status: 503 });

  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const prompt = `你是招聘信息结构化引擎。请只返回 JSON，不要 Markdown，不要解释。将下面 JD 整理为：
{
  "summary": "一句话岗位摘要",
  "responsibilities": ["职责"],
  "requirements": ["要求"],
  "skills": ["技能关键词"],
  "locations": ["工作地点"],
  "salary": "薪资，未知时为空字符串",
  "education": "学历，未知时为空字符串",
  "experience": "经验，未知时为空字符串",
  "recruitmentType": "招聘类型，未知时为空字符串",
  "confidence": 0
}
confidence 为 0 到 100 的数字；不要猜测原文没有的信息。

JD：
${text}`;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 2200,
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: "你只输出合法 JSON，不要输出 Markdown 或解释文字。" }, { role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    if (!response.ok) return NextResponse.json({ ok: false, message: payload.error?.message || `DeepSeek 请求失败（HTTP ${response.status}）` }, { status: 502 });
    const content = payload.choices?.[0]?.message?.content || "";
    if (!content.trim()) return NextResponse.json({ ok: false, message: "DeepSeek 返回为空，请稍后重试" }, { status: 502 });
    const result = parseModelJson(content);
    return NextResponse.json({ ok: true, model, result, analyzedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "DeepSeek 识别失败" }, { status: 502 });
  }
}
