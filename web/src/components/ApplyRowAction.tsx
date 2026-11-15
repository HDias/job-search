import type { Job } from '../api/types';
import { useApplyConfirm } from '../api/hooks';

/**
 * One-click manual apply confirmation for the dashboard list (D1). The click
 * itself is the explicit approval, so the mutation only sends `approved: true`
 * and lets the server keep the channel already stored on the job.
 */
export function ApplyRowAction({ job }: { job: Job }) {
  const confirm = useApplyConfirm(job.id);

  if (job.status === 'applied') {
    return <span className="muted nowrap">aplicada</span>;
  }

  return (
    <div className="row-action">
      <button
        type="button"
        className="button ghost button-small"
        disabled={confirm.isPending}
        onClick={() => confirm.mutate({ approved: true })}
      >
        {confirm.isPending ? 'Marcando…' : 'Marcar como aplicada'}
      </button>
      {confirm.error ? (
        <span className="inline-error" role="alert">
          {confirm.error instanceof Error
            ? confirm.error.message
            : 'Não foi possível confirmar.'}
        </span>
      ) : null}
    </div>
  );
}
