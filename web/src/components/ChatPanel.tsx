import { useState, type FormEvent } from 'react';
import type { Job } from '../api/types';
import { useChat } from '../api/hooks';

interface ChatPanelProps {
  job: Job;
}

interface QuickAction {
  label: string;
  prompt: string;
}

/** D6: quick actions are predefined prompts, not artifact rewrites. */
const QUICK_ACTIONS: QuickAction[] = [
  {
    label: 'Resumir o fit',
    prompt: 'Resuma o fit para esta vaga.',
  },
  {
    label: 'Apontar gaps',
    prompt: 'Quais são os gaps do meu perfil para esta vaga?',
  },
  {
    label: 'Reescrever a carta',
    prompt: 'Sugira uma nova versão da carta de apresentação para esta vaga.',
  },
];

/**
 * Post-response conversation (D3/D6): free chat plus quick actions, both sent
 * through the same synchronous endpoint. The thread lives on the job, so it
 * survives kit regenerations.
 */
export function ChatPanel({ job }: ChatPanelProps) {
  const [message, setMessage] = useState('');
  const chat = useChat(job.id);

  function send(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    chat.mutate(trimmed, {
      onSuccess: () => setMessage(''),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(message);
  }

  return (
    <section className="panel chat-panel">
      <div className="panel-header">
        <h2>Conversa sobre a vaga</h2>
      </div>

      <div className="chat-thread">
        {job.chatHistory.length === 0 ? (
          <p className="muted">
            Pergunte sobre o fit, os gaps ou o próximo passo. A resposta usa
            apenas a vaga e a análise já registradas.
          </p>
        ) : (
          job.chatHistory.map((turn, index) => (
            <div key={`${turn.at}-${index}`} className={`chat-turn chat-${turn.role}`}>
              <strong>{turn.role === 'user' ? 'Você' : 'Assistente'}</strong>
              <p>{turn.content}</p>
            </div>
          ))
        )}
      </div>

      <div className="link-row chat-quick-actions">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            className="button ghost"
            disabled={chat.isPending}
            onClick={() => send(action.prompt)}
          >
            {action.label}
          </button>
        ))}
      </div>

      <form className="chat-form" onSubmit={submit}>
        <label className="field">
          <span>Mensagem</span>
          <textarea
            value={message}
            rows={2}
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <button
          type="submit"
          className="button"
          disabled={chat.isPending || message.trim().length === 0}
        >
          {chat.isPending ? 'Enviando…' : 'Enviar mensagem'}
        </button>
      </form>

      {chat.error ? (
        <p className="inline-error" role="alert">
          {chat.error instanceof Error
            ? chat.error.message
            : 'Não foi possível conversar com a IA.'}
        </p>
      ) : null}
    </section>
  );
}
