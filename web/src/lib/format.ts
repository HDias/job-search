import type { Artifact, JobStatus } from '../api/types';

export const STATUS_LABELS: Record<JobStatus, string> = {
  drafted: 'Rascunho',
  applied: 'Aplicado',
  interview: 'Entrevista',
  offer: 'Proposta',
  rejected: 'Encerrado',
  archived: 'Arquivado',
};

export const STAGE_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  'fit-checked': 'Fit calculado',
  processing: 'Processando',
  'awaiting-language': 'Aguardando idioma',
  'awaiting-fit': 'Aguardando fit',
  done: 'Concluído',
  error: 'Erro',
};

export const ARTIFACT_LABELS: Record<string, string> = {
  cv_html: 'Currículo (HTML)',
  cv_pdf: 'Currículo (PDF)',
  cover_letter_pdf: 'Carta (PDF)',
  cover_letter_html: 'Carta (HTML)',
  cv_with_cover_html: 'Currículo + carta (HTML)',
  cv_with_cover_pdf: 'Currículo + carta (PDF)',
  email_text: 'E-mail de candidatura',
  linkedin_note: 'Mensagem LinkedIn',
  recruiter_note: 'Mensagem ao recrutador',
  questions: 'Perguntas da vaga',
  suggestions: 'Como responder',
  job_posting: 'Texto da vaga',
  other: 'Outro arquivo',
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormatter.format(date);
}

export function formatFit(rating: number | null | undefined): string {
  return typeof rating === 'number' ? `${Math.round(rating)}%` : '—';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function artifactLabel(kind: string): string {
  return ARTIFACT_LABELS[kind] ?? kind;
}

/**
 * Os visualizadores do backend renderizam CV e extras com a barra de ações.
 * Para os demais tipos, o arquivo original é servido direto.
 */
export function artifactHref(jobId: string, artifact: Artifact): string {
  switch (artifact.kind) {
    case 'cv_html':
    case 'cv_pdf':
      return `/cv/${jobId}`;
    case 'email_text':
      return `/extras/${jobId}/email`;
    case 'recruiter_note':
    case 'linkedin_note':
      return `/extras/${jobId}/recruiter`;
    case 'questions':
    case 'suggestions':
      return `/extras/${jobId}/suggestions`;
    default:
      return `/applications/${artifact.relativePath}`;
  }
}

export function fitTone(rating: number | null | undefined): 'high' | 'mid' | 'low' | 'none' {
  if (typeof rating !== 'number') return 'none';
  if (rating >= 80) return 'high';
  if (rating >= 60) return 'mid';
  return 'low';
}
