import { useEffect, useRef, useState } from 'react';
import { useSaveProfile } from '../api/hooks';
import type {
  BaseResumeInfo,
  BaseResumeKey,
  Profile,
} from '../api/types';
import { formatDateTime } from '../lib/format';

interface Combo {
  stack: string;
  language: 'pt-br' | 'en';
}

const COMBOS: Record<BaseResumeKey, Combo> = {
  'pt-br': { stack: 'ruby', language: 'pt-br' },
  en: { stack: 'ruby', language: 'en' },
  'php-pt-br': { stack: 'php', language: 'pt-br' },
  'php-en': { stack: 'php', language: 'en' },
};

const TITLES: Record<BaseResumeKey, string> = {
  'pt-br': 'Ruby (PT-BR)',
  en: 'Ruby (English)',
  'php-pt-br': 'PHP (PT-BR)',
  'php-en': 'PHP (English)',
};

export function BaseResumeCard({
  comboKey,
  info,
  profile,
}: {
  comboKey: BaseResumeKey;
  info?: BaseResumeInfo;
  profile?: Profile;
}) {
  const { stack, language } = COMBOS[comboKey];
  const saveProfile = useSaveProfile();
  const fileInput = useRef<HTMLInputElement>(null);

  const savedText =
    typeof profile?.content?.rawText === 'string' ? profile.content.rawText : '';
  const [text, setText] = useState(savedText);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setText(savedText);
    setFileName(null);
  }, [savedText, profile?.updatedAt]);

  const dirty = text !== savedText;

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
    if (!text.trim()) {
      setLocalError('O texto do currículo não pode ficar vazio.');
      return;
    }
    setLocalError(null);

    const previous =
      profile?.content && typeof profile.content === 'object'
        ? profile.content
        : {};

    saveProfile.mutate({
      stack,
      language,
      content: {
        ...previous,
        stack,
        language,
        rawText: text,
        rawLength: text.length,
        extractedAt: new Date().toISOString(),
        sourceFile: fileName ?? previous.sourceFile ?? 'edição manual',
      },
    });
  }

  const status = info?.exists ? 'Enviado' : 'Não enviado';
  const error =
    localError ??
    (saveProfile.isError
      ? saveProfile.error instanceof Error
        ? saveProfile.error.message
        : 'Não foi possível salvar.'
      : null);

  return (
    <article className="admin-card">
      <div className="admin-card-header">
        <h2>{TITLES[comboKey]}</h2>
        <span className={`badge ${info?.exists ? 'badge-applied' : 'badge-drafted'}`}>
          {status}
        </span>
      </div>

      <p className="muted admin-card-meta">
        {info?.exists
          ? `${info.charCount ?? text.length} caracteres · atualizado em ${formatDateTime(
              info.updatedAt,
            )}`
          : 'Nenhum currículo registrado para esta combinação.'}
      </p>
      {info?.sourceFile ? (
        <p className="muted admin-card-meta admin-source">{info.sourceFile}</p>
      ) : null}

      <label className="field">
        <span>Texto do currículo base</span>
        <textarea
          className="admin-textarea"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`Cole aqui o texto do currículo ${TITLES[comboKey]}...`}
          spellCheck={false}
        />
      </label>

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
          {saveProfile.isPending ? 'Salvando…' : 'Salvar texto'}
        </button>
        {dirty ? (
          <button
            type="button"
            className="button ghost"
            disabled={saveProfile.isPending}
            onClick={() => {
              setText(savedText);
              setFileName(null);
              setLocalError(null);
            }}
          >
            Desfazer
          </button>
        ) : null}
      </div>

      {saveProfile.isSuccess && !dirty ? (
        <p className="inline-ok">Currículo salvo.</p>
      ) : null}
      {error ? (
        <p className="inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}
