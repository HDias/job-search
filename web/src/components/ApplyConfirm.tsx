import { useState, type FormEvent } from 'react';
import type { Job } from '../api/types';
import { useApplyConfirm } from '../api/hooks';

interface ApplyConfirmProps {
  job: Job;
}

function parseEmails(value: string): string[] {
  return value
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Manual confirmation (D1). The app never submits a form: the user records
 * that they applied, and the mutation always sends `approved: true`.
 */
export function ApplyConfirm({ job }: ApplyConfirmProps) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [channel, setChannel] = useState(job.channel ?? '');
  const [emails, setEmails] = useState(job.appliedEmails.join(', '));
  const confirm = useApplyConfirm(job.id);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    confirm.mutate({
      approved: true,
      note,
      channel,
      appliedEmails: parseEmails(emails),
    });
  }

  return (
    <div className="apply-confirm">
      <button
        type="button"
        className="button ghost"
        onClick={() => setOpen((current) => !current)}
      >
        Confirmar candidatura
      </button>

      {open ? (
        <form className="apply-confirm-form" onSubmit={submit}>
          <label className="field">
            <span>Nota</span>
            <textarea
              value={note}
              maxLength={500}
              rows={2}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Canal</span>
            <input
              value={channel}
              maxLength={30}
              onChange={(event) => setChannel(event.target.value)}
            />
          </label>
          <label className="field">
            <span>E-mails usados</span>
            <input
              value={emails}
              placeholder="you@example.com, recruiter@example.com"
              onChange={(event) => setEmails(event.target.value)}
            />
          </label>
          <div className="link-row">
            <button
              type="submit"
              className="button"
              disabled={confirm.isPending}
            >
              {confirm.isPending ? 'Confirmando…' : 'Enviar confirmação'}
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => setOpen(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {confirm.isSuccess ? (
        <p className="inline-ok">Candidatura confirmada.</p>
      ) : null}

      {confirm.error ? (
        <p className="inline-error" role="alert">
          {confirm.error instanceof Error
            ? confirm.error.message
            : 'Não foi possível confirmar a candidatura.'}
        </p>
      ) : null}
    </div>
  );
}
