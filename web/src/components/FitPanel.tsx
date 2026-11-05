import type { Fit } from '../api/types';
import { fitTone, formatFit } from '../lib/format';

const DIMENSIONS: Array<[keyof NonNullable<Fit['dimensions']>, string]> = [
  ['skillsMatch', 'Skills'],
  ['experienceMatch', 'Experiência'],
  ['logisticsMatch', 'Logística'],
  ['cultureMatch', 'Cultura'],
];

export function FitPanel({ fit }: { fit: Fit | null }) {
  if (!fit) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Fit</h2>
        </div>
        <p className="muted">Nenhuma análise de aderência registrada para esta vaga.</p>
      </section>
    );
  }

  const tone = fitTone(fit.rating);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Fit</h2>
        <span className={`fit-pill tone-${tone}`}>{formatFit(fit.rating)}</span>
      </div>

      {fit.analysis ? <p className="fit-analysis">{fit.analysis}</p> : null}

      <div className="fit-meter" aria-hidden="true">
        <span
          className={`fit-meter-fill tone-${tone}`}
          style={{ width: `${Math.max(0, Math.min(100, fit.rating ?? 0))}%` }}
        />
      </div>

      {fit.dimensions ? (
        <dl className="dimensions">
          {DIMENSIONS.map(([key, label]) => {
            const value = fit.dimensions?.[key];
            if (typeof value !== 'number') return null;
            return (
              <div className="dimension" key={key}>
                <dt>{label}</dt>
                <dd>
                  <span className="dimension-track">
                    <span
                      className="dimension-fill"
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </span>
                  <span className="dimension-value">{Math.round(value)}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}

      <div className="fit-lists">
        <div>
          <h3>Pontos fortes</h3>
          {fit.strengths.length > 0 ? (
            <ul className="tag-list tag-list-good">
              {fit.strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum ponto forte listado.</p>
          )}
        </div>
        <div>
          <h3>Gaps</h3>
          {fit.gaps.length > 0 ? (
            <ul className="tag-list tag-list-warn">
              {fit.gaps.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nenhum gap listado.</p>
          )}
        </div>
      </div>

      {fit.eligibility || fit.languageGate || fit.logisticsNote ? (
        <div className="fit-notes">
          {fit.eligibility ? (
            <p>
              <strong>Elegibilidade:</strong>{' '}
              <span className={fit.eligibility.passed ? 'text-good' : 'text-bad'}>
                {fit.eligibility.passed ? 'Aprovada' : 'Bloqueada'}
              </span>{' '}
              — {fit.eligibility.reason}
            </p>
          ) : null}
          {fit.languageGate ? (
            <p>
              <strong>Idioma:</strong> {fit.languageGate.required}{' '}
              <span className={fit.languageGate.passed ? 'text-good' : 'text-bad'}>
                {fit.languageGate.passed ? 'ok' : 'reprovado'}
              </span>
              {fit.languageGate.note ? ` — ${fit.languageGate.note}` : ''}
            </p>
          ) : null}
          {fit.logisticsNote ? (
            <p>
              <strong>Logística:</strong> {fit.logisticsNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
