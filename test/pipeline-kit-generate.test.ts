import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PDF_THEME } from '../src/pipeline/pdf-theme.js';
import type { LlmClient } from '../src/pipeline/llm/client.js';
import type { ResolvedProfile } from '../src/pipeline/profiles.js';
import { createSkillLoader } from '../src/pipeline/skills/loader.js';
import {
  buildKitPrompt,
  generateKit,
  parseKitOrQuestion,
  resolveKitJobData,
  validateNeedsInputPayload,
  type KitGenerationDeps,
  type KitJobData,
} from '../src/pipeline/kit/generate.js';

const SKILLS_DIR = path.resolve('skills');

const BASE_RESUME = [
  'Horecio Dias',
  'horecio@example.com',
  'Senior Software Engineer.',
  'Built products for small teams and mentored developers.',
].join('\n');

const JOB: KitJobData = {
  title: 'Senior Software Engineer',
  company: 'Acme',
  location: 'Remote',
  url: 'https://example.com/jobs/1',
  applyUrl: 'https://example.com/jobs/1/apply',
  detectedLanguage: 'en',
  content: 'Build reliable products for small teams. Requirements: experience shipping software.',
  extraQuestions: '',
  recruiterMessage: '',
};

const VALID_RESUME_HTML = `<!DOCTYPE html><html><head><style>:root{--accent:#B56A6A}.accent{height:8px;background:#B56A6A}h2.section-title{border-top:2px solid #B56A6A}</style></head><body><div class="accent"></div><div class="resume-container"><h1 class="candidate-name">Horecio Dias</h1><div class="target-title">Senior Software Engineer</div><div class="location-line">Remote</div><div class="contact-info">horecio@example.com</div><h2 class="section-title">Summary</h2><p class="summary-text">Senior engineer shipping products for small teams.</p><h2 class="section-title">Highlights</h2><p class="skills"><strong>Backend:</strong> Ruby | <strong>Data:</strong> PostgreSQL</p><h2 class="section-title">Experience</h2><div class="job-entry"><h3 class="job-title">Senior Software Engineer - Acme</h3><div class="job-company">Acme</div><div class="job-meta">Remote</div><ul class="bullet-list"><li>Shipped products for small teams.</li></ul></div><h2 class="section-title">Education &amp; Certifications</h2><div class="edu-entry"><div class="edu-degree">Computer Science</div><div class="edu-school">University</div></div><div class="languages">English - Professional Working</div></div></body></html>`;

const KIT = {
  company: 'Acme',
  role: 'Senior Software Engineer',
  fitRating: 85,
  fitAnalysis: 'Strong technical match.',
  tailoredResumeHtml: VALID_RESUME_HTML,
  coverLetterHtml: '<!DOCTYPE html><html><body><p>Dear Acme,</p></body></html>',
  emailSubject: 'Application: Senior Software Engineer',
  emailBody: 'Hello, I am interested.',
  emailNotes: 'Sourced from the posting.',
  linkedInConnectionNote: 'Hi, quick note.',
  linkedInInMail: 'Longer message.',
};

function profile(): ResolvedProfile {
  return {
    profile: {
      stack: 'ruby',
      language: 'en',
      content: { rawText: BASE_RESUME },
      enabled: true,
      extraPrompt: null,
      updatedAt: new Date().toISOString(),
    },
    stack: 'ruby',
    language: 'en',
    rawText: BASE_RESUME,
  };
}

function deps(responses: string[]): KitGenerationDeps & {
  calls: { prompt: string; system: string }[];
} {
  const calls: { prompt: string; system: string }[] = [];
  const llm: LlmClient = {
    async call(prompt, system = '') {
      calls.push({ prompt, system });
      const next = responses.shift();
      if (next === undefined) throw new Error('LLM stub exhausted');
      return next;
    },
  };
  const base: KitGenerationDeps = {
    llm,
    loader: createSkillLoader(SKILLS_DIR),
    profile: profile(),
    theme: DEFAULT_PDF_THEME,
  };
  return Object.assign(base, { calls });
}

describe('resolveKitJobData', () => {
  it('reuses the run job snapshot without scraping', () => {
    const data = resolveKitJobData({
      jobSnapshot: { content: 'Cached posting', title: 'Dev', company: 'Acme' },
      url: 'https://example.com/other',
    });
    expect(data.content).toBe('Cached posting');
    expect(data.title).toBe('Dev');
  });

  it('falls back to the pasted text', () => {
    const data = resolveKitJobData({ rawText: 'Pasted posting text' });
    expect(data.content).toBe('Pasted posting text');
    expect(data.detectedLanguage).toBe('pt-br');
  });

  it('throws when there is neither a snapshot nor text', () => {
    expect(() => resolveKitJobData({ url: 'https://example.com/jobs/1' })).toThrow(
      /conteúdo da vaga/i,
    );
  });
});

describe('parseKitOrQuestion', () => {
  it('accepts fenced JSON kits', () => {
    const parsed = parseKitOrQuestion('```json\n' + JSON.stringify(KIT) + '\n```');
    expect(parsed.type).toBe('kit');
  });

  it('turns unknown text into a needs_input question', () => {
    const parsed = parseKitOrQuestion('sorry, I cannot do that');
    expect(parsed.type).toBe('needs_input');
    if (parsed.type === 'needs_input') {
      expect(parsed.question).toBeTruthy();
      expect(parsed.kind).toBe('missing_fact');
      expect(parsed.options).toEqual([]);
    }
  });

  it('rejects a needsInput envelope with a non-high inference', () => {
    expect(() =>
      validateNeedsInputPayload({
        needsInput: true,
        question: 'Can I list AWS?',
        kind: 'inference_approval',
        inferences: [{ skill: 'AWS', inferredFrom: 'cloud', confidence: 'medium' }],
      }),
    ).toThrow(/confidence/);
  });
});

describe('buildKitPrompt', () => {
  it('injects the base resume, coverage and clarification blocks', () => {
    const prompt = buildKitPrompt({
      job: JOB,
      baseRawText: BASE_RESUME,
      stack: 'ruby',
      language: 'en',
      theme: DEFAULT_PDF_THEME,
      userAnswer: 'I am based in Brazil.',
      rejectedInferences: ['Kubernetes'],
    });
    expect(prompt.prompt).toContain('CURRÍCULO BASE');
    expect(prompt.prompt).toContain('Horecio Dias');
    expect(prompt.prompt).toContain('USER_CLARIFICATION');
    expect(prompt.prompt).toContain('I am based in Brazil.');
    expect(prompt.prompt).toContain('Kubernetes');
    expect(prompt.prompt).toContain('#B56A6A');
    expect(prompt.accent).toBe('#B56A6A');
  });
});

describe('generateKit', () => {
  it('returns the kit on the first valid response', async () => {
    const d = deps([JSON.stringify(KIT)]);
    const result = await generateKit(
      { job: JOB, stack: 'ruby', language: 'en' },
      d,
    );

    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.kit.company).toBe('Acme');
    expect(result.kit.resumeHtml).toContain('candidate-name');
    expect(result.kit.coverLetterHtml).toContain('Dear Acme');
    expect(result.kit.emailSubject).toBe('Application: Senior Software Engineer');
    expect(result.validation.attempts).toBe(1);
    expect(result.validation.ok).toBe(true);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0].system).toContain('ZERO LIES');
    expect(d.calls[0].prompt).toContain('NÚCLEO PRESERVADO');
  });

  it('tolerates a JSON kit inside a markdown fence', async () => {
    const d = deps(['```json\n' + JSON.stringify(KIT) + '\n```']);
    const result = await generateKit({ job: JOB, stack: 'ruby', language: 'en' }, d);
    expect(result.status).toBe('done');
  });

  it('returns a needs_input question with the next round count', async () => {
    const d = deps([
      JSON.stringify({
        needsInput: true,
        question: 'Which Rails version did you use?',
        options: ['7', '8'],
        blockingField: 'rails_version',
        kind: 'missing_fact',
      }),
    ]);
    const result = await generateKit(
      { job: JOB, stack: 'ruby', language: 'en', needsInputRounds: 0 },
      d,
    );

    expect(result.status).toBe('needs_input');
    if (result.status !== 'needs_input') return;
    expect(result.question.question).toContain('Rails version');
    expect(result.question.options).toEqual(['7', '8']);
    expect(result.question.blockingField).toBe('rails_version');
    expect(result.needsInputRounds).toBe(1);
  });

  it('fails instead of asking a third clarification round', async () => {
    const d = deps([
      JSON.stringify({ needsInput: true, question: 'Still missing?', blockingField: 'x' }),
    ]);
    const result = await generateKit(
      { job: JOB, stack: 'ruby', language: 'en', needsInputRounds: 2 },
      d,
    );

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.error).toMatch(/Limite de clarificações/);
  });

  it('retries at most twice and fails with the remaining violations', async () => {
    const broken = JSON.stringify({
      ...KIT,
      tailoredResumeHtml: '<html><body><p>No layout classes at all.</p></body></html>',
    });
    const d = deps([broken, broken, broken, broken]);
    const result = await generateKit({ job: JOB, stack: 'ruby', language: 'en' }, d);

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.validation?.attempts).toBe(3);
    expect(result.validation?.ok).toBe(false);
    expect(result.error).toContain('accent-missing');
    // initial call + exactly two fix prompts
    expect(d.calls).toHaveLength(3);
    expect(d.calls[1].prompt).toContain('Corrija o HTML');
  });

  it('accepts a kit fixed by the second attempt', async () => {
    const broken = JSON.stringify({
      ...KIT,
      tailoredResumeHtml: '<html><body><p>No layout classes at all.</p></body></html>',
    });
    const fixed = JSON.stringify({ tailoredResumeHtml: VALID_RESUME_HTML });
    const d = deps([broken, fixed]);
    const result = await generateKit({ job: JOB, stack: 'ruby', language: 'en' }, d);

    expect(result.status).toBe('done');
    if (result.status !== 'done') return;
    expect(result.validation.attempts).toBe(2);
    expect(result.kit.company).toBe('Acme');
    expect(d.calls).toHaveLength(2);
  });
});
