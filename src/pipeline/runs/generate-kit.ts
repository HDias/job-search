import type { JobSnapshot } from '../../domain/run.js';
import { normalizeLang, normalizeStack } from '../content.js';
import { generateKit, resolveKitJobData } from '../kit/generate.js';
import {
  writeKitArtifacts,
  type PdfRenderer,
  type WrittenKit,
} from '../kit/artifacts.js';
import type { LlmClient } from '../llm/client.js';
import { getPdfTheme } from '../pdf-theme.js';
import { resolveProfileWithFallback } from '../profiles.js';
import type { GenerateKitPayload, QueueTask } from '../queue.js';
import type { SkillLoader } from '../skills/loader.js';
import type { Store } from '../../repositories/types.js';

/**
 * Executes one queued kit generation (port of v1 `processJob` + the
 * interactive queue): replay of a pending question without an LLM call,
 * `generating` → `done` | `needs_input` | `failed`, and artifact writing on
 * success. The plain `POST /api/generate-kit` gates already ran in the route.
 */

export interface GenerateKitRunnerDeps {
  store: Store;
  llm: LlmClient;
  loader: SkillLoader;
  /** Base directory of `applications/<folder>/...`. */
  applicationsDir: string;
  /** Injected in tests so Chromium never launches. */
  renderPdf?: PdfRenderer;
  warn?: (message: string) => void;
}

export function createGenerateKitRunner(
  deps: GenerateKitRunnerDeps,
): (task: QueueTask) => Promise<void> {
  const { store } = deps;
  const warn = deps.warn ?? ((message: string) => console.warn(message));

  return async (task) => {
    const run = store.runs.get(task.runId);
    if (!run) return;
    const payload = (task.payload ?? {}) as GenerateKitPayload;

    // Invariant D6: a pending question is replayed as-is while no answer came
    // back — never a second LLM call and never a stage downgrade.
    if (run.stage === 'needs_input' && run.llmQuestion && !payload.userAnswer) {
      return;
    }

    store.runs.update(run.id, { stage: 'generating', error: null });

    try {
      const stack = normalizeStack(payload.stack || run.stack || 'ruby');
      const language = normalizeLang(
        payload.language ||
          (run.languagePreference && run.languagePreference !== 'auto'
            ? run.languagePreference
            : null) ||
          run.suggestedLanguage ||
          run.jobSnapshot?.detectedLanguage ||
          'pt-br',
      );

      const profile = resolveProfileWithFallback(store, stack, language);
      if (!profile) {
        throw new Error(
          `Nenhum currículo base habilitado para stack=${stack} idioma=${language}.`,
        );
      }

      const snapshot =
        (payload.jobSnapshot as JobSnapshot | null | undefined) ??
        run.jobSnapshot ??
        null;
      const job = resolveKitJobData({
        jobSnapshot: snapshot,
        url: payload.url || run.url,
        rawText: payload.rawText,
        extraQuestions: payload.extraQuestions,
        recruiterMessage: payload.recruiterMessage,
      });

      const result = await generateKit(
        {
          job,
          stack,
          language,
          fit: run.fit,
          fitConfirmed: payload.fitConfirmed ?? true,
          needsInputRounds:
            payload.needsInputRounds ?? run.needsInputRounds ?? 0,
          userAnswer: payload.userAnswer ?? null,
          approvedInferences: payload.approvedInferences ?? [],
          rejectedInferences: payload.rejectedInferences ?? [],
          coverLetterGuidance:
            payload.coverLetterGuidance ?? run.coverLetterGuidance ?? null,
          artifactGuidance: payload.artifactGuidance ?? null,
        },
        {
          llm: deps.llm,
          loader: deps.loader,
          profile,
          theme: getPdfTheme(store),
          warn,
        },
      );

      if (result.status === 'needs_input') {
        store.runs.update(run.id, {
          stage: 'needs_input',
          llmQuestion: result.question,
          needsInputRounds: result.needsInputRounds,
          error: null,
        });
        return;
      }

      if (result.status === 'failed') {
        store.runs.update(run.id, { stage: 'failed', error: result.error });
        return;
      }

      // The kit owns a job row: reuse the linked one or create it now so the
      // artifacts have an owner and the dashboard can show the application.
      const existingJob = run.jobId ? store.jobs.get(run.jobId) : null;
      const jobRow =
        existingJob ??
        store.jobs.create({
          company: result.kit.company || job.company,
          role: result.kit.role || job.title,
          vacancyUrl: job.url || null,
          applyUrl: job.applyUrl || null,
          language,
          stack,
          fit: run.fit,
          fitConfirmed: payload.fitConfirmed ?? true,
        });

      let written: WrittenKit;
      try {
        written = await writeKitArtifacts(
          {
            store,
            applicationsDir: deps.applicationsDir,
            jobId: jobRow.id,
            runId: run.id,
            kit: result.kit,
            job,
            language,
            stack,
            fit: run.fit,
            fitConfirmed: payload.fitConfirmed ?? true,
            coverLetterGuidance:
              payload.coverLetterGuidance ?? run.coverLetterGuidance,
            includeCoverInCv: payload.includeCoverInCv ?? run.includeCoverInCv,
            artifacts: payload.artifacts,
            copyMissingFrom: payload.regenerateFromFolder ?? null,
          },
          { renderPdf: deps.renderPdf, warn },
        );
      } catch (error) {
        store.runs.update(run.id, {
          stage: 'failed',
          jobId: jobRow.id,
          error: `Falha ao gravar os artefatos do kit: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
        return;
      }

      store.runs.update(run.id, {
        stage: 'done',
        jobId: jobRow.id,
        llmQuestion: null,
        error: null,
      });

      warn(
        `[Kit] run ${run.id} concluído em ${written.folder} (${written.files.length} arquivos)`,
      );
    } catch (error) {
      store.runs.update(run.id, {
        stage: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
