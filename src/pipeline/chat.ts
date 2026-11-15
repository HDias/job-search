import type { ChatMessage, Fit, Job } from '../domain/job.js';
import type { JobSnapshot } from '../domain/run.js';
import type { Store } from '../repositories/types.js';
import type { LlmClient } from './llm/client.js';
import type { SkillLoader } from './skills/loader.js';

/**
 * Post-response conversation with the LLM (D3/D5).
 *
 * Synchronous on purpose: the user expects an answer in the same request, and
 * the FIFO run queue would serialize the chat behind heavy kit generations.
 * The prompt is grounded on the scraped posting + the fit analysis, and the
 * zero-lies rule is always injected through the system prompt.
 */

/** Older turns are dropped from the prompt, not from the persisted thread. */
export const CHAT_HISTORY_PROMPT_LIMIT = 12;
/** The scraped posting can be huge; the chat keeps the beginning. */
export const CHAT_POSTING_PROMPT_LIMIT = 12000;

export type ChatOutcome =
  | { status: 'not_found' }
  | { status: 'empty_message' }
  | { status: 'no_context' }
  | { status: 'ok'; reply: string; chat: ChatMessage[] };

export interface ChatDeps {
  store: Store;
  loader: SkillLoader;
  llm: LlmClient;
}

interface ChatContext {
  job: Job;
  snapshot: JobSnapshot | null;
  fit: Fit | null;
  history: ChatMessage[];
  message: string;
}

/** Reuses the skill assets (safety protocol) instead of a detached prompt. */
export function buildChatSystemPrompt(loader: SkillLoader): string {
  const { safetyProtocol } = loader.loadReferences();
  const safety = safetyProtocol ? `\n---\n${safetyProtocol.slice(0, 4000)}\n---` : '';

  return `You are a post-application assistant for one specific job.
SUPREME RULE: ZERO LIES (STRICT GROUNDING).
- Answer ONLY from the job posting, the fit analysis and the conversation provided below.
- NEVER invent roles, companies, dates, degrees, metrics, tools or facts.
- If the context does not contain the answer, say so explicitly and suggest what the user could add.
- Apply the "Interview Retraction Test": everything suggested must be defensible in a real interview.
- Do not claim an application was submitted: the app never submits forms on its own.
- Do not rewrite the kit artifacts; regeneration goes through the pipeline, not the chat.
- Answer in the language of the user's latest message.${safety}`;
}

function fitSection(fit: Fit): string {
  const dimensions = fit.dimensions ?? {};
  const lines = [
    `Rating: ${fit.rating ?? 'unknown'}`,
    `Dimensions: skills=${dimensions.skillsMatch ?? '-'}, experience=${
      dimensions.experienceMatch ?? '-'
    }, logistics=${dimensions.logisticsMatch ?? '-'}, culture=${
      dimensions.cultureMatch ?? '-'
    }`,
  ];
  if (fit.strengths.length > 0) {
    lines.push(`Strengths:\n${fit.strengths.map((item) => `- ${item}`).join('\n')}`);
  }
  if (fit.gaps.length > 0) {
    lines.push(`Gaps:\n${fit.gaps.map((item) => `- ${item}`).join('\n')}`);
  }
  if (fit.eligibility) {
    lines.push(
      `Eligibility: ${fit.eligibility.passed ? 'passed' : 'blocked'} — ${fit.eligibility.reason}`,
    );
  }
  if (fit.analysis) lines.push(`Analysis:\n${fit.analysis}`);
  return lines.join('\n');
}

export function buildChatPrompt(context: ChatContext): string {
  const { job, snapshot, fit, history, message } = context;

  const sections: string[] = [
    `=== JOB METADATA ===
Company: ${job.company}
Role: ${job.role}
Language: ${job.language}
URL: ${job.vacancyUrl ?? snapshot?.url ?? 'not informed'}
Status: ${job.status}`,
  ];

  const posting = snapshot?.content?.trim();
  if (posting) {
    sections.push(
      `=== JOB POSTING ===\n${posting.slice(0, CHAT_POSTING_PROMPT_LIMIT)}`,
    );
  }

  if (fit) sections.push(`=== FIT ANALYSIS ===\n${fitSection(fit)}`);

  if (history.length > 0) {
    const transcript = history
      .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
      .join('\n');
    sections.push(`=== CONVERSATION SO FAR ===\n${transcript}`);
  }

  sections.push(`=== NEW USER MESSAGE ===\n${message}`);
  return sections.join('\n\n');
}

/**
 * The provider error may echo the request (including the key). The chat never
 * returns it to the client: redact the credentials and throw a generic message.
 */
export function redactSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[redacted]');
}

function latestSnapshot(store: Store, jobId: string): JobSnapshot | null {
  const runs = store.runs.list({ jobId });
  const withContent = runs.find((run) => run.jobSnapshot?.content?.trim());
  return withContent?.jobSnapshot ?? runs[0]?.jobSnapshot ?? null;
}

function latestFit(store: Store, job: Job): Fit | null {
  if (job.fit) return job.fit;
  const runs = store.runs.list({ jobId: job.id });
  return runs.find((run) => run.fit)?.fit ?? null;
}

export async function respondToChat(
  deps: ChatDeps,
  jobId: string,
  message: string,
): Promise<ChatOutcome> {
  const job = deps.store.jobs.get(jobId);
  if (!job) return { status: 'not_found' };

  const trimmed = message.trim();
  if (!trimmed) return { status: 'empty_message' };

  const snapshot = latestSnapshot(deps.store, job.id);
  const fit = latestFit(deps.store, job);
  if (!snapshot?.content?.trim() && !fit) return { status: 'no_context' };

  const history = job.chatHistory.slice(-CHAT_HISTORY_PROMPT_LIMIT);
  const prompt = buildChatPrompt({
    job,
    snapshot,
    fit,
    history,
    message: trimmed,
  });
  const system = buildChatSystemPrompt(deps.loader);

  let rawReply: string;
  try {
    rawReply = await deps.llm.call(prompt, system);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Falha ao consultar a IA: ${redactSecrets(detail)}`);
  }

  const reply = rawReply.trim();
  if (!reply) throw new Error('Falha ao consultar a IA: resposta vazia.');

  const now = new Date().toISOString();
  const chat: ChatMessage[] = [
    ...job.chatHistory,
    { role: 'user', content: trimmed, at: now },
    { role: 'assistant', content: reply, at: now },
  ];

  deps.store.jobs.update(job.id, { chatHistory: chat });
  return { status: 'ok', reply, chat };
}
