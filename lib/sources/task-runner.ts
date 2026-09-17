import { importSource } from "../source-import";
import type { SourceCollectionCursor } from "../source-import";
import { persistImportedJobs } from "../supabase/import-repository";
import { updateCollectionRun, updateSourceCursor } from "../supabase/collection-repository";

export async function runCollectionTask(input: {
  runId: string;
  company: string;
  url: string;
  adapterKey?: string;
  sourceId?: string;
  cursor?: SourceCollectionCursor;
}) {
  const startedAtMs = Date.now();
  try {
    const imported = await importSource(input.company, input.url, { cursor: input.cursor });
    const persistence = await persistImportedJobs({
      company: input.company,
      url: input.url,
      jobs: imported.jobs,
      attempts: imported.attempts,
      adapterKey: imported.adapterKey,
    });
    const status = imported.ok && persistence.persisted ? "succeeded" : "partial";
    const attemptStages = [...new Set(imported.attempts.map((attempt) => attempt.stage).filter(Boolean))];
    const attemptErrors = imported.attempts
      .filter((attempt) => attempt.error)
      .slice(0, 5)
      .map((attempt) => ({
        stage: attempt.stage,
        error: attempt.error?.slice(0, 300),
      }));
    const screenshotAttempts = imported.attempts.filter((attempt) => Boolean(attempt.screenshotUrl));
    const paginationAttempts = imported.attempts.filter((attempt) => attempt.stage === "browser-pagination");
    const paginationMetadata = paginationAttempts.at(-1)?.metadata;
    const nextPage = typeof paginationMetadata?.nextPage === "number" ? paginationMetadata.nextPage : null;
    const startPage = typeof paginationMetadata?.startPage === "number" ? paginationMetadata.startPage : input.cursor?.page ?? 1;
    const pages = typeof paginationMetadata?.pages === "number" ? paginationMetadata.pages : 0;
    const exhausted = paginationMetadata?.exhausted === true;
    let cursorPersistence: { attempted: boolean; persisted: boolean; nextPage?: number; message?: string } = { attempted: false, persisted: false };
    if (input.sourceId && nextPage && imported.ok && persistence.persisted) {
      cursorPersistence = { attempted: true, persisted: false, nextPage };
      try {
        const cursor: SourceCollectionCursor = { page: exhausted ? 1 : nextPage, updatedAt: new Date().toISOString() };
        await updateSourceCursor(input.sourceId, cursor);
        cursorPersistence.persisted = true;
      } catch (error) {
        cursorPersistence.message = error instanceof Error ? error.message : "来源游标保存失败";
      }
    }
    await updateCollectionRun(input.runId, {
      status,
      finished_at: new Date().toISOString(),
      fetched_count: imported.jobs.length,
      accepted_count: persistence.jobs,
      rejected_count: Math.max(0, imported.jobs.length - persistence.jobs),
      error: imported.ok ? null : imported.message,
      stats: {
        schemaVersion: "collection-run.v2",
        method: imported.method,
        stage: imported.stage,
        adapterKey: imported.adapterKey,
        adapterStatus: imported.adapterStatus,
        attempts: imported.attempts.length,
        attemptStages,
        attemptErrors,
        durationMs: Date.now() - startedAtMs,
        paginationAttempts: paginationAttempts.length,
        cursor: { startPage, pages, nextPage, exhausted, persistence: cursorPersistence },
        screenshotCaptured: screenshotAttempts.length > 0,
        screenshotAttemptCount: screenshotAttempts.length,
        persistence,
      },
    });
    return { imported, persistence, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : "采集任务失败";
    await updateCollectionRun(input.runId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error: message,
      stats: {
        schemaVersion: "collection-run.v2",
        adapterKey: input.adapterKey ?? "generic-public",
        durationMs: Date.now() - startedAtMs,
        failureStage: "task-runner",
        retryable: true,
        cursorPersistence: { attempted: false, persisted: false },
        error: message.slice(0, 300),
      },
    }).catch(() => undefined);
    throw error;
  }
}
