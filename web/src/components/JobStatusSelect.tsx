import type { Job, JobStatus } from '../api/types';
import { JOB_STATUSES } from '../api/types';
import { useApplyConfirm, useUpdateJob } from '../api/hooks';
import { STATUS_LABELS } from '../lib/format';

/**
 * Interactive status cell, mirroring the v1 select. Choosing "Aplicado" goes
 * through the apply-confirm route instead of a plain PATCH, so the confirmation
 * lock runs and `appliedAt`/`applyMethod` are recorded.
 */
export function JobStatusSelect({ job }: { job: Job }) {
  const update = useUpdateJob();
  const confirm = useApplyConfirm(job.id);
  const pending = update.isPending || confirm.isPending;
  const error = update.error ?? confirm.error;

  function change(next: JobStatus) {
    if (next === job.status) return;
    if (next === 'applied') {
      confirm.mutate({ approved: true });
      return;
    }
    update.mutate({ id: job.id, patch: { status: next } });
  }

  return (
    <div className="row-action">
      <select
        className={`status-select badge-${job.status}`}
        aria-label="Status da vaga"
        value={job.status}
        disabled={pending}
        onChange={(event) => change(event.target.value as JobStatus)}
      >
        {JOB_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </select>
      {error ? (
        <span className="inline-error" role="alert">
          {error instanceof Error ? error.message : 'Não foi possível atualizar.'}
        </span>
      ) : null}
    </div>
  );
}
