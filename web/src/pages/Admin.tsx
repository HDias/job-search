import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useCandidateData,
  usePdfTheme,
  useSaveCandidateData,
  useSavePdfTheme,
} from '../api/hooks';
import type { CandidateData } from '../api/types';
import { ErrorState, LoadingState } from '../components/StateMessage';

const DEFAULT_RUBY = '#B56A6A';
const DEFAULT_PHP = '#4F5B93';

const CANDIDATE_FIELDS: Array<{
  key: keyof CandidateData;
  label: string;
  placeholder: string;
}> = [
  { key: 'fullName', label: 'Nome completo', placeholder: 'Horecio Araujo Dias' },
  { key: 'email', label: 'E-mail', placeholder: 'voce@exemplo.com' },
  { key: 'phone', label: 'Telefone', placeholder: '+55 11 99999-9999' },
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/...' },
  { key: 'github', label: 'GitHub / portfólio', placeholder: 'https://github.com/...' },
];

export function Admin() {
  const pdfTheme = usePdfTheme();
  const candidate = useCandidateData();
  const savePdfTheme = useSavePdfTheme();
  const saveCandidate = useSaveCandidateData();

  const [rubyAccent, setRubyAccent] = useState(DEFAULT_RUBY);
  const [phpAccent, setPhpAccent] = useState(DEFAULT_PHP);
  const [form, setForm] = useState<CandidateData>({});

  useEffect(() => {
    const theme = pdfTheme.data?.theme;
    if (theme?.ruby?.accent) setRubyAccent(theme.ruby.accent);
    if (theme?.php?.accent) setPhpAccent(theme.php.accent);
  }, [pdfTheme.data]);

  useEffect(() => {
    if (candidate.data?.candidate) setForm(candidate.data.candidate);
  }, [candidate.data]);

  function saveTheme(ruby: string, php: string) {
    savePdfTheme.mutate({
      ruby: { accent: ruby },
      php: { accent: php },
    });
  }

  function updateForm(field: keyof CandidateData, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Configuração</p>
          <h1>Admin</h1>
          <p className="muted">
            Aparência do PDF e dados usados nos formulários de candidatura.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Alvos e currículos base</h2>
          <span className="muted">agora em App Settings</span>
        </div>
        <p className="muted">
          As combinações stack × idioma, o currículo base e as instruções extras
          de prompt ficam na página App Settings.
        </p>
        <div className="admin-actions">
          <Link className="button" to="/admin/settings">
            Abrir App Settings
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Aparência do PDF</h2>
          <span className="muted">faixa de identidade por stack</span>
        </div>
        <p className="muted">
          Cor da faixa do currículo gerado. Ruby usa vermelho e PHP usa azul por padrão.
          Cores são validadas em <code>#RRGGBB</code> pela API.
        </p>

        {pdfTheme.isLoading ? <LoadingState label="Carregando tema…" /> : null}

        {pdfTheme.isError ? (
          <ErrorState
            message={
              pdfTheme.error instanceof Error
                ? pdfTheme.error.message
                : 'Erro desconhecido'
            }
            onRetry={() => void pdfTheme.refetch()}
          />
        ) : null}

        {pdfTheme.data ? (
          <>
            <div className="theme-grid">
              <div className="theme-row">
                <input
                  type="color"
                  aria-label="Cor da faixa Ruby"
                  value={rubyAccent}
                  onChange={(event) => setRubyAccent(event.target.value.toUpperCase())}
                />
                <div>
                  <label>Ruby</label>
                  <code>{rubyAccent.toUpperCase()}</code>
                </div>
                <span
                  className="theme-swatch"
                  style={{ background: rubyAccent }}
                  aria-hidden="true"
                />
              </div>

              <div className="theme-row">
                <input
                  type="color"
                  aria-label="Cor da faixa PHP"
                  value={phpAccent}
                  onChange={(event) => setPhpAccent(event.target.value.toUpperCase())}
                />
                <div>
                  <label>PHP</label>
                  <code>{phpAccent.toUpperCase()}</code>
                </div>
                <span
                  className="theme-swatch"
                  style={{ background: phpAccent }}
                  aria-hidden="true"
                />
              </div>
            </div>

            <div className="admin-actions">
              <button
                type="button"
                className="button"
                disabled={savePdfTheme.isPending}
                onClick={() => saveTheme(rubyAccent, phpAccent)}
              >
                {savePdfTheme.isPending ? 'Salvando…' : 'Salvar cores'}
              </button>
              <button
                type="button"
                className="button ghost"
                disabled={savePdfTheme.isPending}
                onClick={() => {
                  setRubyAccent(DEFAULT_RUBY);
                  setPhpAccent(DEFAULT_PHP);
                  saveTheme(DEFAULT_RUBY, DEFAULT_PHP);
                }}
              >
                Restaurar padrões
              </button>
            </div>

            {savePdfTheme.isSuccess ? <p className="inline-ok">Tema salvo.</p> : null}
            {savePdfTheme.isError ? (
              <p className="inline-error" role="alert">
                {savePdfTheme.error instanceof Error
                  ? savePdfTheme.error.message
                  : 'Não foi possível salvar o tema.'}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Dados do formulário</h2>
          <span className="muted">usados no preenchimento de candidaturas</span>
        </div>
        <p className="muted">
          O backend deriva <code>firstName</code> e <code>lastName</code> a partir do nome completo.
        </p>

        {candidate.isLoading ? <LoadingState label="Carregando dados…" /> : null}

        {candidate.isError ? (
          <ErrorState
            message={
              candidate.error instanceof Error
                ? candidate.error.message
                : 'Erro desconhecido'
            }
            onRetry={() => void candidate.refetch()}
          />
        ) : null}

        {candidate.data ? (
          <>
            <div className="form-grid">
              {CANDIDATE_FIELDS.map((field) => (
                <label className="field" key={String(field.key)}>
                  <span>{field.label}</span>
                  <input
                    type="text"
                    value={String(form[field.key] ?? '')}
                    placeholder={field.placeholder}
                    onChange={(event) => updateForm(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>

            <div className="admin-actions">
              <button
                type="button"
                className="button"
                disabled={saveCandidate.isPending}
                onClick={() => saveCandidate.mutate(form)}
              >
                {saveCandidate.isPending ? 'Salvando…' : 'Salvar dados'}
              </button>
            </div>

            {saveCandidate.isSuccess ? <p className="inline-ok">Dados salvos.</p> : null}
            {saveCandidate.isError ? (
              <p className="inline-error" role="alert">
                {saveCandidate.error instanceof Error
                  ? saveCandidate.error.message
                  : 'Não foi possível salvar os dados.'}
              </p>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
