import type { Artifact } from '../api/types';
import { artifactHref, artifactLabel, formatBytes, formatDate } from '../lib/format';

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

export function ArtifactList({ jobId, artifacts }: { jobId: string; artifacts: Artifact[] }) {
  const items = latestByKind(artifacts);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Arquivos</h2>
        <span className="muted">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p className="muted">Nenhum artefato gerado para esta vaga.</p>
      ) : (
        <ul className="artifact-list">
          {items.map((artifact) => (
            <li key={artifact.id}>
              <a
                className="artifact-link"
                href={artifactHref(jobId, artifact)}
                target="_blank"
                rel="noreferrer"
              >
                <span className="artifact-name">{artifactLabel(artifact.kind)}</span>
                <span className="artifact-meta">
                  {formatDate(artifact.createdAt)}
                  {formatBytes(artifact.sizeBytes)
                    ? ` · ${formatBytes(artifact.sizeBytes)}`
                    : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
