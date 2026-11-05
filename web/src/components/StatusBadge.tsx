import type { JobStatus } from '../api/types';
import { STATUS_LABELS } from '../lib/format';

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge badge-${status}`} data-status={status}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
