import { useState, type FormEvent } from 'react';
import { useRegenerateKit } from '../api/hooks';
import type { Artifact } from '../api/types';
import { artifactHref, artifactLabel, formatBytes, formatDate } from '../lib/format';
import { KIT_FILE_OPTIONS } from '../lib/kitFiles';

const ORDER = [
  'cv_pdf',
  'cv_html',
  'cv_with_cover_pdf',
  'cv_with_cover_html',
  'cover_letter_pdf',
  'cover_letter_html',
  'email_text',
  'recruiter_note',
  'linkedin_note',
  'suggestions',
  'questions',
  'job_posting',
];

function rank(kind: string): number {
  const index = ORDER.indexOf(kind);
  return index === -1 ? ORDER.length : index;
}

/** Vários runs podem gerar o mesmo tipo; mostramos o mais recente de cada. */
function latestByKind(artifacts: Artifact[]): Artifact[] {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const current = map.get(artifact.kind);
    if (!current || artifact.createdAt > current.createdAt) {
      map.set(artifact.kind, artifact);
    }
  }
  return [...map.values()].sort((a, b) => rank(a.kind) - rank(b.kind));
}

interface ArtifactListProps {
  jobId: string;
  artifacts: Artifact[];
  /** A run is active: wait before rebuilding the kit. */
  busy?: boolean;
}

interface EditingState {
  kind: string;
  notes: string;
  missing: boolean;
}

export function ArtifactList({
  jobId,
  artifacts,
  busy = false,
}: ArtifactListProps) {
  // `other` (fit audit, pasted context…) is internal metadata, not a deliverable.
  const visible = artifacts.filter((artifact) => artifact.kind !== 'other');
  const items = latestByKind(visible);
  const regenerate = useRegenerateKit(jobId);
  const [editing, setEditing] = useState<EditingState | null>(null);

  const existingKinds = new Set(visible.map((artifact) => artifact.kind));
  // Only a job that already has a kit offers the "generate later" rows.
  const missing =
    visible.length > 0
      ? KIT_FILE_OPTIONS.filter(({ kind }) => !existingKinds.has(kind))
      : [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    regenerate.mutate({
      artifacts: [...new Set([...existingKinds, editing.kind])],
      guidance: editing.notes.trim() || undefined,
    });
    setEditing(null);
  }

  function renderForm(state: EditingState) {
    return (
      <form className="artifact-regen" onSubmit={submit}>
        <label className="field">
          <span>
            Considerações para {state.missing ? 'gerar' : 'regenerar'}{' '}
            (opcional)
          </span>
          <textarea
            rows={2}
            value={state.notes}
            placeholder="Ex.: dar mais ênfase à experiência com X; tom mais direto; mencionar Y."
            onChange={(event) =>
              setEditing((current) =>
                current ? { ...current, notes: event.target.value } : current,
              )
            }
          />
        </label>
        <div className="link-row">
          <button
            type="submit"
            className="button button-small"
            disabled={regenerate.isPending}
          >
            {regenerate.isPending
              ? 'Gerando…'
              : state.missing
                ? 'Gerar agora'
                : 'Regerar agora'}
          </button>
          <button
            type="button"
            className="button ghost button-small"
            onClick={() => setEditing(null)}
          >
            Cancelar
          </button>
        </div>
      </form>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Arquivos</h2>
        <span className="muted">{items.length}</span>
      </div>

      {items.length === 0 && missing.length === 0 ? (
        <p className="muted">
          Nenhum artefato gerado para esta vaga. Gere o kit em "Próximos passos".
        </p>
      ) : (
        <ul className="artifact-list">
          {items.map((artifact) => (
            <li key={artifact.id}>
              <div className="artifact-row">
                <a
                  className="artifact-link"
                  href={artifactHref(jobId, artifact)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span className="artifact-name">
                    {artifactLabel(artifact.kind)}
                  </span>
                  <span className="artifact-meta">
                    {formatDate(artifact.createdAt)}
                    {formatBytes(artifact.sizeBytes)
                      ? ` · ${formatBytes(artifact.sizeBytes)}`
                      : ''}
                  </span>
                </a>
                <button
                  type="button"
                  className="button ghost button-small"
                  disabled={busy || regenerate.isPending}
                  onClick={() =>
                    setEditing({ kind: artifact.kind, notes: '', missing: false })
                  }
                >
                  Regerar
                </button>
              </div>
              {editing?.kind === artifact.kind ? renderForm(editing) : null}
            </li>
          ))}

          {missing.map(({ kind, label }) => (
            <li key={`missing-${kind}`}>
              <div className="artifact-row">
                <div className="artifact-link artifact-missing">
                  <span className="artifact-name">{label}</span>
                  <span className="artifact-meta">não gerado</span>
                </div>
                <button
                  type="button"
                  className="button ghost button-small"
                  disabled={busy || regenerate.isPending}
                  onClick={() => setEditing({ kind, notes: '', missing: true })}
                >
                  Gerar
                </button>
              </div>
              {editing?.kind === kind ? renderForm(editing) : null}
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 ? (
        <p className="muted">
          Arquivos não gerados podem ser criados depois em "Gerar": o kit é
          refeito a partir da vaga já salva, sem raspar de novo.
        </p>
      ) : null}

      {regenerate.error ? (
        <p className="inline-error" role="alert">
          {regenerate.error instanceof Error
            ? regenerate.error.message
            : 'Não foi possível gerar o arquivo.'}
        </p>
      ) : null}
    </section>
  );
}
