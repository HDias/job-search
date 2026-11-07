import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useCreateProfile, useProfiles } from '../api/hooks';
import { TargetCard } from '../components/TargetCard';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '../components/StateMessage';

type TargetLanguage = 'pt-br' | 'en';

function addError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Essa combinação já existe.';
    return error.message;
  }
  return 'Não foi possível adicionar o alvo.';
}

export function AppSettings() {
  const profiles = useProfiles();
  const createProfile = useCreateProfile();

  const [stack, setStack] = useState('');
  const [language, setLanguage] = useState<TargetLanguage>('en');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = stack.trim().toLowerCase();
    if (!normalized) return;

    createProfile.mutate(
      { stack: normalized, language },
      { onSuccess: () => setStack('') },
    );
  }

  const list = [...(profiles.data ?? [])].sort(
    (a, b) =>
      a.stack.localeCompare(b.stack) || a.language.localeCompare(b.language),
  );

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Configuração</p>
          <h1>App Settings</h1>
          <p className="muted">
            Alvos de candidatura (stack × idioma), currículo base e instruções
            extras usadas nos prompts de fit e tailor.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Adicionar alvo</h2>
          <span className="muted">combinação stack × idioma</span>
        </div>
        <p className="muted">
          A stack é livre (slug em minúsculas). O idioma natural aceito hoje é
          PT-BR ou inglês.
        </p>

        <form className="filters" onSubmit={submit}>
          <label className="field">
            <span>Stack</span>
            <input
              list="stack-options"
              value={stack}
              placeholder="ruby, php, elixir…"
              onChange={(event) => setStack(event.target.value)}
            />
            <datalist id="stack-options">
              <option value="ruby" />
              <option value="php" />
            </datalist>
          </label>

          <label className="field">
            <span>Idioma</span>
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as TargetLanguage)
              }
            >
              <option value="pt-br">PT-BR</option>
              <option value="en">English</option>
            </select>
          </label>

          <button
            type="submit"
            className="button"
            disabled={!stack.trim() || createProfile.isPending}
          >
            {createProfile.isPending ? 'Adicionando…' : 'Adicionar alvo'}
          </button>
        </form>

        {createProfile.isError ? (
          <p className="inline-error" role="alert">
            {addError(createProfile.error)}
          </p>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Alvos configurados</h2>
          <span className="muted">
            {list.length} {list.length === 1 ? 'alvo' : 'alvos'}
          </span>
        </div>

        {profiles.isLoading ? (
          <LoadingState label="Carregando alvos…" />
        ) : null}

        {profiles.isError ? (
          <ErrorState
            message={
              profiles.error instanceof Error
                ? profiles.error.message
                : 'Erro desconhecido'
            }
            onRetry={() => void profiles.refetch()}
          />
        ) : null}

        {profiles.data && list.length === 0 ? (
          <EmptyState
            title="Nenhum alvo configurado."
            description="Adicione uma combinação stack × idioma para começar."
          />
        ) : null}

        {list.length > 0 ? (
          <div className="admin-grid">
            {list.map((profile) => (
              <TargetCard
                key={`${profile.stack}:${profile.language}`}
                profile={profile}
              />
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
