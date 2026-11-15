import { useEffect, useState, type FormEvent } from 'react';
import type { Job } from '../api/types';
import { useUpdateJob } from '../api/hooks';

/**
 * Inline channel editor. The channel is normally recorded by "Marcar como
 * aplicada", but a draft may already have one (LinkedIn, Trampos, referral…)
 * and the user needs a way to fix it without going through the whole form.
 */
export function JobChannelEditor({ job }: { job: Job }) {
  const [channel, setChannel] = useState(job.channel ?? '');
  const update = useUpdateJob();

  useEffect(() => {
    setChannel(job.channel ?? '');
  }, [job.channel]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = channel.trim();
    if (value === (job.channel ?? '')) return;
    update.mutate({ id: job.id, patch: { channel: value || null } });
  }

  return (
    <div className="channel-editor">
      <form onSubmit={save}>
        <input
          aria-label="Canal da candidatura"
          value={channel}
          maxLength={30}
          placeholder="LinkedIn, Trampos, indicação…"
          onChange={(event) => setChannel(event.target.value)}
        />
        <button
          type="submit"
          className="button ghost button-small"
          disabled={
            update.isPending || channel.trim() === (job.channel ?? '')
          }
        >
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>

      {update.isSuccess ? (
        <p className="inline-ok">Canal atualizado.</p>
      ) : null}
      {update.error ? (
        <p className="inline-error" role="alert">
          {update.error instanceof Error
            ? update.error.message
            : 'Não foi possível salvar o canal.'}
        </p>
      ) : null}
    </div>
  );
}
