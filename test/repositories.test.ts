import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fit } from '../src/domain/job.js';
import { createTestStore } from './helpers.js';

let ctx: ReturnType<typeof createTestStore>;

beforeEach(() => {
  ctx = createTestStore();
});

afterEach(() => {
  ctx.cleanup();
});

const fullFit: Fit = {
  rating: 87.5,
  analysis: 'Forte aderência em Rails.',
  dimensions: {
    skillsMatch: 90,
    experienceMatch: 85,
    logisticsMatch: 95,
    cultureMatch: 80,
  },
  strengths: ['Rails', 'PostgreSQL'],
  gaps: ['Node.js'],
  eligibility: { passed: true, reason: 'Remoto na América Latina.' },
  languageGate: { required: 'en', passed: true, note: 'Inglês profissional.' },
  logisticsNote: null,
};

describe('SqliteJobRepository', () => {
  it('cria, busca e preserva os campos aninhados (fit)', () => {
    const { store } = ctx;
    const created = store.jobs.create({
      company: 'Andela',
      role: 'Senior Backend',
      language: 'en',
      status: 'applied',
      appliedAt: '2026-10-28T12:00:00.000Z',
      fit: fullFit,
      appliedEmails: ['recrutador@andela.com'],
    });

    expect(created.id).toMatch(/^app_/);
    expect(created.ownerId).toBe('local');
    expect(created.createdAt).toBeTruthy();

    const found = store.jobs.get(created.id);
    expect(found).toEqual(created);
    expect(found?.fit?.rating).toBe(87.5);
    expect(found?.fit?.dimensions?.skillsMatch).toBe(90);
    expect(found?.fit?.strengths).toEqual(['Rails', 'PostgreSQL']);
    expect(found?.fit?.gaps).toEqual(['Node.js']);
    expect(found?.appliedEmails).toEqual(['recrutador@andela.com']);
  });

  it('aplica defaults seguros quando só empresa e cargo são informados', () => {
    const { store } = ctx;
    const job = store.jobs.create({ company: 'Beta', role: 'Frontend' });

    expect(job.language).toBe('pt-br');
    expect(job.stack).toBe('ruby');
    expect(job.languageConfirmation).toBeNull();
    expect(job.status).toBe('drafted');
    expect(job.appliedAt).toBeNull();
    expect(job.fit).toBeNull();
    expect(job.appliedEmails).toEqual([]);
    expect(job.hasRecruiterMessage).toBe(false);
    expect(job.hasQuestions).toBe(false);
  });

  it('preserva createdAt/updatedAt recebidos na importação', () => {
    const { store } = ctx;
    const job = store.jobs.create({
      company: 'Legado',
      role: 'Dev',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(job.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(job.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('filtra por status, busca textual e pagina resultados', () => {
    const { store } = ctx;
    store.jobs.create({
      company: 'Acme',
      role: 'Backend Engineer',
      status: 'applied',
      appliedAt: '2026-10-01T12:00:00.000Z',
    });
    store.jobs.create({
      company: 'Acme Labs',
      role: 'Platform Engineer',
      status: 'rejected',
      appliedAt: '2025-01-01T12:00:00.000Z',
    });
    store.jobs.create({
      company: 'Beta',
      role: 'Frontend Engineer',
      status: 'drafted',
    });

    expect(store.jobs.list().total).toBe(3);
    expect(store.jobs.list({ status: 'applied' }).items).toHaveLength(1);
    expect(store.jobs.list({ q: 'acme' }).total).toBe(2);
    expect(store.jobs.list({ q: 'acme' }).items.map((item) => item.company).sort())
      .toEqual(['Acme', 'Acme Labs']);

    const page = store.jobs.list({ limit: 1, offset: 1 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });

  it('atualiza campos e permite limpar o fit', () => {
    const { store } = ctx;
    const job = store.jobs.create({
      company: 'Acme',
      role: 'Backend',
      fit: fullFit,
    });

    const updated = store.jobs.update(job.id, {
      status: 'interview',
      role: 'Staff Backend',
    });

    expect(updated?.status).toBe('interview');
    expect(updated?.role).toBe('Staff Backend');
    expect(updated?.fit?.rating).toBe(87.5);
    expect(updated?.updatedAt).toBeTruthy();

    const cleared = store.jobs.update(job.id, { fit: null });
    expect(cleared?.fit).toBeNull();
    expect(store.jobs.get(job.id)?.fit).toBeNull();
  });

  it('retorna null ao atualizar ou remover id inexistente', () => {
    const { store } = ctx;
    expect(store.jobs.update('app_missing', { status: 'applied' })).toBeNull();
    expect(store.jobs.delete('app_missing')).toBe(false);
  });

  it('remove a vaga, faz cascade nos artefatos e set null no run', () => {
    const { store } = ctx;
    const job = store.jobs.create({ company: 'Acme', role: 'Backend' });
    const run = store.runs.create({ jobId: job.id, stage: 'done' });
    store.artifacts.addMany([
      {
        jobId: job.id,
        runId: run.id,
        kind: 'cv_pdf',
        relativePath: 'acme/curriculo.pdf',
      },
    ]);

    expect(store.jobs.delete(job.id)).toBe(true);
    expect(store.jobs.get(job.id)).toBeNull();
    expect(store.artifacts.listByJob(job.id)).toEqual([]);
    expect(store.runs.get(run.id)?.jobId).toBeNull();
  });

  it('calcula estatísticas do dashboard', () => {
    const { store } = ctx;
    const now = new Date().toISOString();

    store.jobs.create({
      company: 'A',
      role: 'Dev',
      status: 'applied',
      appliedAt: now,
      fit: { ...fullFit, rating: 80 },
    });
    store.jobs.create({
      company: 'B',
      role: 'Dev',
      status: 'rejected',
      appliedAt: '2020-01-01T12:00:00.000Z',
      fit: { ...fullFit, rating: 60 },
    });
    store.jobs.create({ company: 'C', role: 'Dev', status: 'drafted' });

    const stats = store.jobs.stats();
    expect(stats.total).toBe(3);
    expect(stats.byStatus).toEqual({ applied: 1, rejected: 1, drafted: 1 });
    expect(stats.averageFitRating).toBeCloseTo(70);
    expect(stats.appliedLast30Days).toBe(1);
  });
});

describe('SqliteRunRepository', () => {
  it('cria, lista por vaga e atualiza um run', () => {
    const { store } = ctx;
    const job = store.jobs.create({ company: 'Acme', role: 'Backend' });

    const run = store.runs.create({
      jobId: job.id,
      stage: 'fit-checked',
      url: 'https://example.com/job/1',
      stack: 'ruby',
      languagePreference: 'en',
      fit: { ...fullFit, rating: 91 },
      job: {
        title: 'Senior Backend',
        company: 'Acme',
        location: 'Remote',
        url: 'https://example.com/job/1',
        detectedLanguage: 'en',
      },
      jobSnapshot: {
        title: 'Senior Backend',
        company: 'Acme',
        location: 'Remote',
        url: 'https://example.com/job/1',
        detectedLanguage: 'en',
        content: 'Descrição completa da vaga.',
        extraQuestions: 'Pergunta extra?',
      },
    });

    expect(run.id).toMatch(/^proc_/);
    expect(run.fit?.rating).toBe(91);
    expect(run.stack).toBe('ruby');
    expect(run.job?.title).toBe('Senior Backend');
    expect(run.jobSnapshot?.title).toBe('Senior Backend');
    expect(run.jobSnapshot?.content).toBe('Descrição completa da vaga.');
    expect(run.jobSnapshot?.extraQuestions).toBe('Pergunta extra?');
    expect(store.runs.list({ jobId: job.id })).toHaveLength(1);
    expect(store.runs.list({ stage: 'fit-checked' })).toHaveLength(1);
    expect(store.runs.list({ stage: 'done' })).toHaveLength(0);

    const updated = store.runs.update(run.id, {
      stage: 'done',
      error: null,
    });
    expect(updated?.stage).toBe('done');
    expect(updated?.fit?.rating).toBe(91);
  });

  it('aceita run sem vaga (jobId nulo) e remove normalmente', () => {
    const { store } = ctx;
    const run = store.runs.create({ stage: 'draft' });

    expect(run.jobId).toBeNull();
    expect(store.runs.list()).toHaveLength(1);
    expect(store.runs.delete(run.id)).toBe(true);
    expect(store.runs.get(run.id)).toBeNull();
    expect(store.runs.delete(run.id)).toBe(false);
  });
});

describe('SqliteArtifactRepository', () => {
  it('ignora artefatos duplicados (job + kind + path)', () => {
    const { store } = ctx;
    const job = store.jobs.create({ company: 'Acme', role: 'Backend' });

    store.artifacts.addMany([
      {
        jobId: job.id,
        runId: null,
        kind: 'cv_pdf',
        relativePath: 'acme/curriculo.pdf',
        mime: 'application/pdf',
        sizeBytes: 10,
      },
      {
        jobId: job.id,
        runId: null,
        kind: 'email_text',
        relativePath: 'acme/email.txt',
        mime: 'text/plain',
        sizeBytes: 5,
      },
      {
        jobId: job.id,
        runId: null,
        kind: 'cv_pdf',
        relativePath: 'acme/curriculo.pdf',
        mime: 'application/pdf',
        sizeBytes: 10,
      },
    ]);

    const artifacts = store.artifacts.listByJob(job.id);
    expect(artifacts).toHaveLength(2);
    expect(artifacts.map((artifact) => artifact.kind).sort()).toEqual([
      'cv_pdf',
      'email_text',
    ]);

    store.artifacts.deleteByJob(job.id);
    expect(store.artifacts.listByJob(job.id)).toEqual([]);
  });
});

describe('SqliteProfileRepository e SqliteSettingsRepository', () => {
  it('faz upsert de perfil por stack + idioma', () => {
    const { store } = ctx;

    store.profiles.upsert({
      stack: 'ruby',
      language: 'pt-br',
      content: { name: 'Horecio', version: 1 },
    });
    store.profiles.upsert({
      stack: 'ruby',
      language: 'pt-br',
      content: { name: 'Horecio', version: 2 },
    });
    store.profiles.upsert({
      stack: 'php',
      language: 'en',
      content: { name: 'Horecio' },
    });

    expect(store.profiles.list()).toHaveLength(2);
    expect(store.profiles.get('ruby', 'pt-br')?.content).toEqual({
      name: 'Horecio',
      version: 2,
    });
    expect(store.profiles.get('php', 'en')).not.toBeNull();
    expect(store.profiles.get('ruby', 'en')).toBeNull();
  });

  it('faz upsert, leitura tipada e remoção de settings', () => {
    const { store } = ctx;

    store.settings.set('pdf_theme', { accent: '#0af' });
    store.settings.set('pdf_theme', { accent: '#f00' });

    expect(store.settings.get<{ accent: string }>('pdf_theme')).toEqual({
      accent: '#f00',
    });
    expect(store.settings.list()).toHaveLength(1);
    expect(store.settings.delete('pdf_theme')).toBe(true);
    expect(store.settings.get('pdf_theme')).toBeNull();
    expect(store.settings.delete('pdf_theme')).toBe(false);
  });
});
