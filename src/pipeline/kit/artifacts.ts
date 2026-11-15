import fs from 'node:fs';
import path from 'node:path';
import type { Artifact, ArtifactKind } from '../../domain/artifact.js';
import type { Fit } from '../../domain/job.js';
import type { Store } from '../../repositories/types.js';
import {
  buildCombinedCvWithCoverHtml,
  detectCoverLetterInCvRequirement,
  generatePdf,
} from '../pdf.js';
import type { KitData, KitJobData } from './generate.js';
import {
  getCandidateFileSlug,
  sanitizeName,
  shortRoleFileSlug,
} from './slug.js';

/**
 * Kit file layout (port of v1 `processJob` step 6): one folder per run under
 * `applications/`, every file registered in `artifacts` with a relative path,
 * mime and size, and the job row updated with the approved fit and flags.
 * PDF rendering is injected so tests never launch Chromium.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

export interface KitSuggestions {
  json: unknown;
  markdown: string;
  readme?: string;
}

export interface WriteKitInput {
  store: Store;
  applicationsDir: string;
  jobId: string;
  runId?: string | null;
  kit: KitData;
  job: KitJobData;
  language: string;
  stack: string;
  fit?: Fit | null;
  fitConfirmed?: boolean;
  coverLetterGuidance?: string | null;
  includeCoverInCv?: string | boolean | null;
  suggestions?: KitSuggestions | null;
  /** Regeneration: folder name (inside `applicationsDir`) to carry extras from. */
  copyMissingFrom?: string | null;
}

export interface PdfRenderResult {
  atsCompatible?: boolean;
}

export type PdfRenderer = (
  htmlPath: string,
  pdfPath: string,
) => Promise<PdfRenderResult | void>;

export interface WriteKitDeps {
  renderPdf?: PdfRenderer;
  warn?: (message: string) => void;
}

export interface WrittenKit {
  /** Folder name inside `applicationsDir`. */
  folder: string;
  /** Files relative to the folder (test/manifest friendly). */
  files: string[];
  /** Every PDF rendered with an extractable text layer? */
  atsCompatible: boolean;
  coverInCv: { required: boolean; reason: string | null };
  artifacts: Artifact[];
}

function mimeFor(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

/** Unique folder: the v1 tracker allows duplicate company+role rows. */
export function uniqueKitFolder(
  applicationsDir: string,
  company: string,
  role: string,
): string {
  const base = `${sanitizeName(company)}_${sanitizeName(role)}`;
  let folder = base;
  for (let n = 2; fs.existsSync(path.join(applicationsDir, folder)); n++) {
    folder = `${base}_${n}`;
  }
  return folder;
}

/** Manual `application_questions.json` shape for pasted extra questions. */
export function buildManualQuestions(
  extraQuestions: string,
): { id: string; label: string; type: string; required: boolean; category: string }[] {
  return extraQuestions
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label, index) => ({
      id: `manual-question-${index + 1}`,
      label,
      type: 'textarea',
      required: false,
      category: 'custom',
    }));
}

/**
 * Writes the kit (posting, fit, resume/cover HTML+PDF, optional combined
 * variant, e-mail/recruiter messages, questions and suggestions), records the
 * artifacts and updates the job.
 */
export async function writeKitArtifacts(
  input: WriteKitInput,
  deps: WriteKitDeps = {},
): Promise<WrittenKit> {
  const { store, kit, job } = input;
  const language = input.language === 'en' ? 'en' : 'pt-br';
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  const renderPdf: PdfRenderer =
    deps.renderPdf ??
    (async (htmlPath, pdfPath) => {
      const result = await generatePdf(htmlPath, pdfPath);
      return { atsCompatible: result.atsCompatible };
    });

  const folder = uniqueKitFolder(
    input.applicationsDir,
    kit.company || job.company,
    kit.role || job.title,
  );
  const targetDir = path.join(input.applicationsDir, folder);
  fs.mkdirSync(targetDir, { recursive: true });

  const files: string[] = [];
  const recorded: {
    kind: ArtifactKind;
    relativePath: string;
    mime: string;
    sizeBytes: number;
  }[] = [];

  const record = (
    relativeName: string,
    kind: ArtifactKind,
    sizeBytes: number,
  ): void => {
    files.push(relativeName);
    recorded.push({
      kind,
      relativePath: `${folder}/${relativeName}`,
      mime: mimeFor(relativeName),
      sizeBytes,
    });
  };

  const writeText = (
    relativeName: string,
    content: string,
    kind: ArtifactKind,
  ): void => {
    const fullPath = path.join(targetDir, relativeName);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
    record(relativeName, kind, Buffer.byteLength(content, 'utf8'));
  };

  const pdfResults: (PdfRenderResult | void)[] = [];
  const writePdf = async (
    htmlRelative: string,
    pdfRelative: string,
    kind: ArtifactKind,
  ): Promise<void> => {
    const htmlPath = path.join(targetDir, htmlRelative);
    const pdfPath = path.join(targetDir, pdfRelative);
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    pdfResults.push(await renderPdf(htmlPath, pdfPath));
    const size = fs.existsSync(pdfPath) ? fs.statSync(pdfPath).size : 0;
    record(pdfRelative, kind, size);
  };

  // Posting + approved fit (audit trail of the skill).
  writeText(
    'job_posting.md',
    `# ${job.title} - ${job.company}\n\nFonte: ${job.url}\n\n${job.content}`,
    'job_posting',
  );
  if (input.fit) {
    writeText(
      'fit_check.json',
      JSON.stringify(
        {
          confirmedAt: new Date().toISOString(),
          fitConfirmed: Boolean(input.fitConfirmed),
          fit: input.fit,
        },
        null,
        2,
      ),
      'other',
    );
  }

  const extraQuestions = String(job.extraQuestions ?? '').trim();
  if (extraQuestions) {
    writeText(
      'application_questions.json',
      JSON.stringify(
        {
          applicationUrl: job.applyUrl || '',
          scrapedAt: new Date().toISOString(),
          platform: 'manual',
          questions: buildManualQuestions(extraQuestions),
          standardFields: [],
        },
        null,
        2,
      ),
      'questions',
    );
  }

  if (job.recruiterMessage) {
    writeText(
      'mensagem_recrutador_origem.txt',
      String(job.recruiterMessage).slice(0, 6000),
      'other',
    );
  }

  const guidance = String(input.coverLetterGuidance ?? '').trim().slice(0, 2000);
  if (guidance) {
    writeText('cover_letter_direcionamento.txt', guidance, 'other');
  }

  if (input.suggestions) {
    writeText(
      'materiais_extras/sugestoes_respostas.json',
      JSON.stringify(input.suggestions.json, null, 2),
      'other',
    );
    writeText(
      'materiais_extras/sugestoes_respostas.md',
      input.suggestions.markdown,
      'suggestions',
    );
    if (input.suggestions.readme) {
      writeText('materiais_extras/README.md', input.suggestions.readme, 'other');
    }
  }

  // Resume HTML + PDF (download name: <Candidate>-<Short Role>.pdf).
  const candidateSlug = getCandidateFileSlug(store);
  const shortRole = shortRoleFileSlug(kit.role || job.title);
  writeText('curriculo_direcionado.html', kit.resumeHtml, 'cv_html');
  const resumePdf = `${candidateSlug}-${shortRole}.pdf`;
  await writePdf('curriculo_direcionado.html', resumePdf, 'cv_pdf');

  // Cover letter is always kept separate when the kit has one.
  if (kit.coverLetterHtml) {
    writeText('cover_letter.html', kit.coverLetterHtml, 'cover_letter_html');
    await writePdf('cover_letter.html', 'cover_letter.pdf', 'cover_letter_pdf');
  }

  // Combined CV+cover variant only when the posting asks for it (or forced).
  const detection = detectCoverLetterInCvRequirement(
    `${job.content || ''}\n${job.extraQuestions || ''}`,
  );
  const flag = input.includeCoverInCv;
  const forced = flag === true || flag === 'true' || flag === 'force';
  const disabled = flag === false || flag === 'false' || flag === 'never';
  let coverInCvRequired =
    !disabled && (forced || (flag !== 'never' && detection.required));
  let coverInCvReason = forced
    ? 'Forçamento explícito (includeCoverInCv=true).'
    : detection.reason;

  if (coverInCvRequired && !kit.coverLetterHtml) {
    warn(
      '[Kit] Vaga pede cover no CV, mas sem coverLetterHtml — variante combinada ignorada.',
    );
    coverInCvRequired = false;
    coverInCvReason = null;
  }

  if (coverInCvRequired && kit.coverLetterHtml) {
    const combinedHtml = buildCombinedCvWithCoverHtml(
      kit.resumeHtml,
      kit.coverLetterHtml,
      language,
    );
    writeText(
      'curriculo_direcionado_com_cover.html',
      combinedHtml,
      'cv_with_cover_html',
    );
    await writePdf(
      'curriculo_direcionado_com_cover.html',
      `${candidateSlug}-${shortRole}-${language === 'en' ? 'With-Cover' : 'Com-Cover'}.pdf`,
      'cv_with_cover_pdf',
    );
  }

  const emailNotes = kit.emailNotes
    ? `\n\n--- Personalização (sinais da vaga) ---\n${kit.emailNotes}`
    : '';
  writeText(
    'email_candidatura.txt',
    `Assunto: ${kit.emailSubject}\n\n${kit.emailBody}${emailNotes}`,
    'email_text',
  );

  const recruiterHeader = job.recruiterMessage
    ? `=== CONTEXTO (mensagem do recrutador, colada por você) ===\n${String(
        job.recruiterMessage,
      ).slice(0, 2000)}\n\n`
    : '';
  const recruiterBody = `${recruiterHeader}=== RESPOSTA CURTA (conexão/WhatsApp, <= 300 caracteres) ===\n${kit.linkedInConnectionNote}\n\n=== MENSAGEM LONGA (InMail/WhatsApp/e-mail, 100-150 palavras) ===\n${kit.linkedInInMail}`;
  writeText('mensagem_recrutador.txt', recruiterBody, 'linkedin_note');
  writeText('mensagem_linkedin.txt', recruiterBody, 'recruiter_note');

  // Regeneration: the fresh generation may not reproduce the extras from the
  // previous folder. Copy what is missing (v1 fallback) so the "questions"
  // and recruiter context links survive.
  let copiedQuestions = false;
  let copiedRecruiter = false;
  const copyMissingFrom = String(input.copyMissingFrom ?? '').trim();
  if (copyMissingFrom && copyMissingFrom !== folder) {
    const sourceDir = path.join(input.applicationsDir, copyMissingFrom);
    const carried: [string, ArtifactKind, 'questions' | 'recruiter' | null][] = [
      ['application_questions.json', 'questions', 'questions'],
      ['materiais_extras/sugestoes_respostas.json', 'other', null],
      ['materiais_extras/sugestoes_respostas.md', 'suggestions', null],
      ['mensagem_recrutador_origem.txt', 'other', 'recruiter'],
    ];
    for (const [relativeName, kind, marker] of carried) {
      if (files.includes(relativeName)) continue;
      const sourcePath = path.join(sourceDir, relativeName);
      if (!fs.existsSync(sourcePath)) continue;
      writeText(relativeName, fs.readFileSync(sourcePath, 'utf8'), kind);
      if (marker === 'questions') copiedQuestions = true;
      if (marker === 'recruiter') copiedRecruiter = true;
    }
  }

  // Replace the job's previous artifact rows: a regenerated kit owns the list.
  store.artifacts.deleteByJob(input.jobId);
  store.artifacts.addMany(
    recorded.map((item) => ({
      jobId: input.jobId,
      runId: input.runId ?? null,
      kind: item.kind,
      relativePath: item.relativePath,
      mime: item.mime,
      sizeBytes: item.sizeBytes,
    })),
  );

  const fit: Fit = input.fit ?? {
    rating: kit.fitRating || null,
    analysis: kit.fitAnalysis || null,
    strengths: [],
    gaps: [],
  };
  store.jobs.update(input.jobId, {
    fit,
    fitConfirmed: input.fitConfirmed ?? null,
    language,
    stack: input.stack,
    coverInCvRequired,
    coverInCvReason,
    coverLetterGuidance: guidance || null,
    hasRecruiterMessage: Boolean(job.recruiterMessage) || copiedRecruiter,
    hasQuestions: Boolean(extraQuestions) || copiedQuestions,
    skillGrounded: true,
  });

  return {
    folder,
    files,
    atsCompatible: pdfResults.every(
      (result) => (result as PdfRenderResult | undefined)?.atsCompatible !== false,
    ),
    coverInCv: { required: coverInCvRequired, reason: coverInCvReason },
    artifacts: store.artifacts.listByJob(input.jobId),
  };
}
