import { useEffect, useRef, useState } from 'react';
import { useDeleteProfile, useSaveProfile } from '../api/hooks';
import {
  EXTRA_PROMPT_MAX_LENGTH,
  type Profile,
  type ProfilePatch,
} from '../api/types';
import { formatDateTime } from '../lib/format';

function savedContent(profile: Profile): string {
  const rawText = profile.content?.rawText;
  return typeof rawText === 'string' ? rawText : '';
}

export function TargetCard({ profile }: { profile: Profile }) {
  const saveProfile = useSaveProfile();
  const deleteProfile = useDeleteProfile();
  const fileInput = useRef<HTMLInputElement>(null);

  const savedText = savedContent(profile);
  const savedExtra = profile.extraPrompt ?? '';
  const [text, setText] = useState(savedText);
  const [extra, setExtra] = useState(savedExtra);
  const [enabled, setEnabled] = useState(profile.enabled);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setText(savedText);
    setExtra(savedExtra);
    setEnabled(profile.enabled);
    setFileName(null);
    setLocalError(null);
  }, [savedText, savedExtra, profile.enabled, profile.updatedAt]);

  const dirty =
    text !== savedText ||
    extra !== savedExtra ||
    enabled !== profile.enabled;
  const hasContent = savedText.trim().length > 0;
  const title = `${profile.stack} (${profile.language})`;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setLocalError(null);

    if (/\.pdf$/i.test(file.name)) {
      setLocalError(
        'PDF ainda não é extraído no v2. Converta para .txt/.md/.html ou cole o texto.',
      );
      return;
    }

    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
    } catch {
      setLocalError('Não foi possível ler o arquivo.');
    }
  }

  function save() {
    setLocalError(null);

    const trimmedExtra = extra.trim();
    if (trimmedExtra.length > EXTRA_PROMPT_MAX_LENGTH) {
      setLocalError(
        `As instruções extras passam do limite de ${EXTRA_PROMPT_MAX_LENGTH} caracteres.`,
      );
      return;
    }

    const contentChanged = text !== savedText;
    if (contentChanged && !text.trim()) {
      setLocalError('O texto do currículo não pode ficar vazio.');
      return;
    }

    const patch: ProfilePatch = {
      enabled,
      extraPrompt: trimmedExtra.length > 0 ? trimmedExtra : null,
    };

    if (contentChanged) {
      const previous = profile.content ?? {};
      patch.content = {
        ...previous,
        stack: profile.stack,
        language: profile.language,
        rawText: text,
        rawLength: text.length,
        extractedAt: new Date().toISOString(),
        sourceFile: fileName ?? previous.sourceFile ?? 'edição manual',
      };
    }

    saveProfile.mutate({
      stack: profile.stack,
      language: profile.language,
      patch,
    });
  }

  function remove() {
    const confirmed = window.confirm(
      `Remover o alvo ${title}? O currículo base salvo será apagado.`,
    );
    if (!confirmed) return;
    setLocalError(null);
    deleteProfile.mutate({
      stack: profile.stack,
      language: profile.language,
    });
  }

  function undo() {
    setText(savedText);
    setExtra(savedExtra);
    setEnabled(profile.enabled);
    setFileName(null);
    setLocalError(null);
  }

  const error =
    localError ??
    (saveProfile.isError
      ? saveProfile.error instanceof Error
        ? saveProfile.error.message
        : 'Não foi possível salvar o alvo.'
      : null) ??
    (deleteProfile.isError
      ? deleteProfile.error instanceof Error
        ? deleteProfile.error.message
        : 'Não foi possível remover o alvo.'
      : null);

  return (
    <article className="admin-card" aria-label={`Alvo ${title}`}>
      <div className="admin-card-header">
        <h2>{title}</h2>
        <span className={`badge ${hasContent ? 'badge-applied' : 'badge-drafted'}`}>
          {hasContent ? 'Enviado' : 'Não enviado'}
        </span>
      </div>

      <p className="muted admin-card-meta">
        {hasContent
          ? `${savedText.length} caracteres · atualizado em ${formatDateTime(
              profile.updatedAt,
            )}`
          : 'Nenhum currículo registrado para este alvo.'}
      </p>
      {profile.content?.sourceFile ? (
        <p className="muted admin-card-meta admin-source">
          {profile.content.sourceFile}
        </p>
      ) : null}

      <label className="target-active">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>Ativo (o pipeline futuro considera só alvos ativos)</span>
      </label>

      <label className="field">
        <span>Texto do currículo base</span>
        <textarea
          className="admin-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Cole aqui o texto do currículo ${title}...`}
          spellCheck={false}
        />
      </label>

      <label className="field">
        <span>Instruções extras (fit e tailor)</span>
        <textarea
          className="admin-textarea target-extra"
          value={extra}
          maxLength={EXTRA_PROMPT_MAX_LENGTH}
          onChange={(event) => setExtra(event.target.value)}
          placeholder="Ex.: priorizar Laravel e APIs REST; evitar tom acadêmico."
          spellCheck={false}
        />
      </label>
      <p className="muted target-counter">
        {extra.length}/{EXTRA_PROMPT_MAX_LENGTH} caracteres · instrução de
        estilo, não fonte de fatos
      </p>

      <div className="admin-actions">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.md,.markdown,.html,.htm"
          hidden
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="button ghost"
          onClick={() => fileInput.current?.click()}
        >
          Carregar arquivo
        </button>
        <button
          type="button"
          className="button"
          disabled={!dirty || saveProfile.isPending}
          onClick={save}
        >
          {saveProfile.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        {dirty ? (
          <button
            type="button"
            className="button ghost"
            disabled={saveProfile.isPending}
            onClick={undo}
          >
            Desfazer
          </button>
        ) : null}
        <button
          type="button"
          className="button ghost target-remove"
          disabled={deleteProfile.isPending}
          onClick={remove}
        >
          {deleteProfile.isPending ? 'Removendo…' : 'Remover'}
        </button>
      </div>

      {saveProfile.isSuccess && !dirty ? (
        <p className="inline-ok">Alvo salvo.</p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
