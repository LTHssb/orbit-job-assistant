import { createSupabaseAdminClient } from "./admin";

export const RESUME_MAX_BYTES = 10 * 1024 * 1024;

export const RESUME_MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

type ResumeUploadInput = {
  userId: string;
  file: File;
};

type ResumeUploadResult =
  | { configured: false; message: string }
  | { configured: true; ok: true; documentId: string; status: "uploaded"; originalName: string; byteSize: number }
  | { configured: true; ok: false; status: 400 | 413 | 502; message: string };

function extensionFor(file: File) {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "pdf" || extension === "doc" || extension === "docx") return extension;
  return null;
}

function mimeFor(file: File, extension: string | null) {
  if (file.type === RESUME_MIME_TYPES.pdf || file.type === RESUME_MIME_TYPES.doc || file.type === RESUME_MIME_TYPES.docx) return file.type;
  if (file.type === "application/octet-stream" || !file.type) {
    return extension ? RESUME_MIME_TYPES[extension as keyof typeof RESUME_MIME_TYPES] : null;
  }
  return null;
}

export async function storeResumeUpload({ userId, file }: ResumeUploadInput): Promise<ResumeUploadResult> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { configured: false, message: "文件服务暂未配置，请稍后重试。" };

  const extension = extensionFor(file);
  const mimeType = mimeFor(file, extension);
  if (!extension || !mimeType) return { configured: true, ok: false, status: 400, message: "只支持 PDF、DOC、DOCX 简历文件。" };
  if (file.size <= 0) return { configured: true, ok: false, status: 400, message: "文件内容为空，请重新选择。" };
  if (file.size > RESUME_MAX_BYTES) return { configured: true, ok: false, status: 413, message: "简历文件不能超过 10 MB。" };

  const id = crypto.randomUUID();
  const storagePath = `${userId}/${id}.${extension}`;
  const bytes = await file.arrayBuffer();
  const upload = await admin.storage.from("resumes").upload(storagePath, bytes, {
    contentType: mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  if (upload.error) return { configured: true, ok: false, status: 502, message: "简历保存失败，请稍后重试。" };

  const inserted = await admin.from("resume_documents").insert({
    id,
    user_id: userId,
    storage_path: storagePath,
    original_name: file.name.slice(0, 255),
    mime_type: mimeType,
    byte_size: file.size,
    status: "uploaded",
  }).select("id,status,original_name,byte_size").single();

  if (inserted.error || !inserted.data) {
    await admin.storage.from("resumes").remove([storagePath]);
    return { configured: true, ok: false, status: 502, message: "简历元数据保存失败，请稍后重试。" };
  }

  return {
    configured: true,
    ok: true,
    documentId: inserted.data.id,
    status: inserted.data.status,
    originalName: inserted.data.original_name,
    byteSize: inserted.data.byte_size,
  };
}
