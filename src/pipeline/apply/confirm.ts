import {
  APPLIED_EMAILS_MAX,
  APPLY_CHANNEL_MAX_LENGTH,
  APPLY_NOTE_MAX_LENGTH,
  type ApplyConfirmInput,
  type Job,
} from '../../domain/job.js';
import type { Store } from '../../repositories/types.js';

/**
 * Manual apply confirmation (v1 `apply-confirm`, D1). The app never submits a
 * form by itself: the job only becomes `applied` after an explicit
 * `approved: true`, and every derived field is sanitized before persisting.
 */

export type ApplyConfirmOutcome =
  | { status: 'not_found' }
  | { status: 'not_approved' }
  | { status: 'ok'; job: Job };

export const NOT_APPROVED_MESSAGE =
  'Confirmação explícita necessária (approved: true). O app nunca envia sem seu "Sim".';

function splitEmails(input: ApplyConfirmInput['appliedEmails']): string[] {
  if (input === undefined) return [];
  return Array.isArray(input) ? input : input.split(/[,;\n]+/);
}

/** Trims, drops blanks/duplicates and keeps the first 10 unique e-mails. */
export function normalizeAppliedEmails(
  input: ApplyConfirmInput['appliedEmails'],
  fallback: string[],
): string[] {
  if (input === undefined) return fallback;

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const entry of splitEmails(input)) {
    const email = String(entry).trim();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
    if (emails.length === APPLIED_EMAILS_MAX) break;
  }
  return emails;
}

/** Prefers the body value, then the job's channel, then the v1 `portal`. */
export function normalizeApplyChannel(
  input: string | null | undefined,
  fallback: string | null,
): string {
  const candidate = typeof input === 'string' ? input.trim() : '';
  const base = candidate || fallback || 'portal';
  return base.toLowerCase().slice(0, APPLY_CHANNEL_MAX_LENGTH);
}

export function confirmApplication(
  store: Store,
  jobId: string,
  input: ApplyConfirmInput,
): ApplyConfirmOutcome {
  const job = store.jobs.get(jobId);
  if (!job) return { status: 'not_found' };
  if (input.approved !== true) return { status: 'not_approved' };

  const updated = store.jobs.update(job.id, {
    status: 'applied',
    applyMethod: 'manual',
    channel: normalizeApplyChannel(input.channel, job.channel),
    appliedEmails: normalizeAppliedEmails(input.appliedEmails, job.appliedEmails),
    appliedAt: new Date().toISOString(),
    applyNote: String(input.note ?? '').slice(0, APPLY_NOTE_MAX_LENGTH),
  });

  if (!updated) return { status: 'not_found' };
  return { status: 'ok', job: updated };
}
