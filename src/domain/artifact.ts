export const ARTIFACT_KINDS = [
  'cv_html',
  'cv_pdf',
  'cover_letter_pdf',
  'cover_letter_html',
  'cv_with_cover_html',
  'cv_with_cover_pdf',
  'email_text',
  'linkedin_note',
  'recruiter_note',
  'questions',
  'suggestions',
  'job_posting',
  'other',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Artifact {
  id: string;
  jobId: string;
  runId: string | null;
  kind: ArtifactKind | string;
  /** Caminho relativo ao diretório de artefatos (ex.: "andela.../curriculo.pdf"). */
  relativePath: string;
  mime: string | null;
  sizeBytes: number | null;
  createdAt: string;
}
