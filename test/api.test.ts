import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { createTestStore } from './helpers.js';

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let applicationsDir: string;
let baseProfileDir: string;

function seed(store: ReturnType<typeof createTestStore>['store']) {
  const job = store.jobs.create({
    id: 'app_1',
    company: 'Andela',
    role: 'Senior Backend Software Engineer',
    language: 'en',
    languageConfirmation: 'user-confirmed',
    stack: 'ruby',
    channel: 'linkedin',
    status: 'applied',
    appliedAt: '2026-10-28T12:00:00.000Z',
    vacancyUrl: 'https://example.com/job/1',
    fit: {
      rating: 77.5,
      analysis: 'Forte aderência em Rails.',
      dimensions: { skillsMatch: 60, experienceMatch: 85 },
      strengths: ['Rails'],
      gaps: ['Node.js'],
      eligibility: { passed: true, reason: 'Remoto.' },
      languageGate: { required: 'en', passed: true, note: 'OK' },
      logisticsNote: null,
    },
    hasRecruiterMessage: true,
  });

  const run = store.runs.create({
    id: 'proc_1',
    jobId: job.id,
    stage: 'fit-checked',
    url: 'https://example.com/job/1',
    stack: 'ruby',
    languagePreference: 'en',
    job: {
      title: 'Senior Backend Software Engineer',
      company: 'Andela',
      location: 'Remote',
    },
    jobSnapshot: {
      title: 'Senior Backend Software Engineer',
      company: 'Andela',
      location: 'Remote',
      content: 'Texto completo da vaga.',
    },
    fit: {
      rating: 80,
      strengths: ['Rails'],
      gaps: ['Node.js'],
      dimensions: { skillsMatch: 90 },
    },
  });

  store.runs.create({ id: 'proc_done', jobId: job.id, stage: 'done' });

  mkdirSync(path.join(applicationsDir, 'acme'), { recursive: true });
  writeFileSync(
    path.join(applicationsDir, 'acme', 'curriculo.html'),
    '<!DOCTYPE html><html><body><h1>Currículo</h1></body></html>',
  );
  writeFileSync(path.join(applicationsDir, 'acme', 'curriculo.pdf'), 'PDF');
  writeFileSync(path.join(applicationsDir, 'acme', 'email.txt'), 'Olá, segue meu currículo.');
  writeFileSync(
    path.join(applicationsDir, 'acme', 'recrutador.txt'),
    'Mensagem para o recrutador.',
  );

  store.artifacts.addMany([
    {
      jobId: job.id,
      runId: run.id,
      kind: 'cv_html',
      relativePath: 'acme/curriculo.html',
      mime: 'text/html',
    },
    {
      jobId: job.id,
      runId: run.id,
      kind: 'cv_pdf',
      relativePath: 'acme/curriculo.pdf',
      mime: 'application/pdf',
    },
    {
      jobId: job.id,
      runId: run.id,
      kind: 'email_text',
      relativePath: 'acme/email.txt',
      mime: 'text/plain',
    },
    {
      jobId: job.id,
      runId: run.id,
      kind: 'recruiter_note',
      relativePath: 'acme/recrutador.txt',
      mime: 'text/plain',
    },
  ]);

  store.profiles.upsert({
    stack: 'ruby',
    language: 'pt-br',
    content: {
      rawText: 'Currículo base',
      rawLength: 13,
      sourceFile: 'cv.pdf',
      extractedAt: '2026-10-01T00:00:00.000Z',
    },
  });

  return { job, run };
}

beforeEach(() => {
  ctx = createTestStore();
  applicationsDir = path.join(ctx.dir, 'applications');
  baseProfileDir = path.join(ctx.dir, 'base_profile');
  mkdirSync(baseProfileDir, { recursive: true });
  seed(ctx.store);
  app = createApp({
    store: ctx.store,
    applicationsDir,
    baseProfileDir,
  });
});

afterEach(() => {
  ctx.cleanup();
});

describe('API core', () => {
  it('responde health e stats', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);

    const stats = await request(app).get('/api/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.total).toBe(1);
    expect(stats.body.byStatus.applied).toBe(1);
    expect(stats.body.averageFitRating).toBeCloseTo(77.5);
  });

  it('lista e filtra vagas; rejeita status inválido', async () => {
    const list = await request(app).get('/api/jobs');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].company).toBe('Andela');

    const filtered = await request(app).get('/api/jobs?status=applied&q=andela');
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(1);

    const invalid = await request(app).get('/api/jobs?status=nope');
    expect(invalid.status).toBe(400);
  });

  it('busca vaga com runs e artefatos e trata 404', async () => {
    const res = await request(app).get('/api/jobs/app_1');
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe('app_1');
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.artifacts).toHaveLength(4);

    const missing = await request(app).get('/api/jobs/app_missing');
    expect(missing.status).toBe(404);
  });

  it('cria, atualiza e remove vagas', async () => {
    const created = await request(app).post('/api/jobs').send({
      company: 'Beta',
      role: 'Frontend',
      status: 'drafted',
    });
    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^app_/);

    const patched = await request(app)
      .patch(`/api/jobs/${created.body.id}`)
      .send({ status: 'interview', fit: { rating: 55, strengths: [], gaps: [] } });
    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('interview');
    expect(patched.body.fit.rating).toBe(55);

    const removed = await request(app).delete(`/api/jobs/${created.body.id}`);
    expect(removed.status).toBe(204);

    const invalid = await request(app).post('/api/jobs').send({ role: 'X' });
    expect(invalid.status).toBe(400);
  });

  it('lista runs por vaga e atualiza via /api/runs', async () => {
    const list = await request(app).get('/api/runs?jobId=app_1');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);

    const patched = await request(app)
      .patch('/api/runs/proc_1')
      .send({ stage: 'done' });
    expect(patched.status).toBe(200);
    expect(patched.body.stage).toBe('done');
    expect(patched.body.jobSnapshot.content).toBe('Texto completo da vaga.');
  });
});

describe('compatibilidade com a UI v1', () => {
  it('GET /api/applications devolve o formato legado', async () => {
    const res = await request(app).get('/api/applications');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const appDto = res.body[0];
    expect(appDto.id).toBe('app_1');
    expect(appDto.date).toBe('28/10/2026');
    expect(appDto.fitRating).toBe(77.5);
    expect(appDto.fitDimensions.skillsMatch).toBe(60);
    expect(appDto.languageConfirmation).toBe('user-confirmed');
    expect(appDto.cvPdfFile).toBe('/applications/acme/curriculo.pdf');
    expect(appDto.emailTextFile).toBe('/applications/acme/email.txt');
    expect(appDto.recruiterNoteFile).toBe('/applications/acme/recrutador.txt');
    // LinkedIn herda o mesmo arquivo do recrutador (fallback do v1)
    expect(appDto.linkedInNoteFile).toBe('/applications/acme/recrutador.txt');
  });

  it('PUT /api/applications/:id aceita status legado e preserva o fit', async () => {
    const res = await request(app)
      .put('/api/applications/app_1')
      .send({ status: 'encerrado', fitRating: 85 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.application.status).toBe('rejected');
    expect(res.body.application.fitRating).toBe(85);
    // análise e dimensões que não vieram no body continuam intactas
    expect(res.body.application.fitAnalysis).toBe('Forte aderência em Rails.');
    expect(res.body.application.fitDimensions.experienceMatch).toBe(85);
  });

  it('GET /api/processes esconde os runs concluídos e mantém o formato v1', async () => {
    const res = await request(app).get('/api/processes');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const processDto = res.body[0];
    expect(processDto.id).toBe('proc_1');
    expect(processDto.applicationId).toBe('app_1');
    expect(processDto.stage).toBe('fit-checked');
    expect(processDto.job.title).toBe('Senior Backend Software Engineer');
    expect(processDto.jobSnapshot.content).toBe('Texto completo da vaga.');
    expect(processDto.fit.fitRating).toBe(80);
  });

  it('PUT /api/processes/:id atualiza e desvincula a vaga', async () => {
    const res = await request(app)
      .put('/api/processes/proc_1')
      .send({ stage: 'done', applicationId: null });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.process.stage).toBe('done');
    expect(res.body.process.applicationId).toBeNull();
  });

  it('DELETE /api/applications/:id e /api/processes/:id removem registros', async () => {
    const process = await request(app).delete('/api/processes/proc_1');
    expect(process.status).toBe(200);
    expect(process.body.success).toBe(true);

    const application = await request(app).delete('/api/applications/app_1');
    expect(application.status).toBe(200);
    expect(application.body.success).toBe(true);

    const missing = await request(app).get('/api/jobs/app_1');
    expect(missing.status).toBe(404);
  });
});

describe('artefatos, visualizadores e metadados', () => {
  it('serve o PDF estático e o visualizador de currículo', async () => {
    const pdf = await request(app).get('/applications/acme/curriculo.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const cv = await request(app).get('/cv/app_1');
    expect(cv.status).toBe(200);
    expect(cv.text).toContain('Andela');
    expect(cv.text).toContain('Currículo');
    expect(cv.text).toContain('Baixar PDF');
  });

  it('serve extras de e-mail e recrutador', async () => {
    const email = await request(app).get('/extras/app_1/email');
    expect(email.status).toBe(200);
    expect(email.text).toContain('Olá, segue meu currículo.');

    const recruiter = await request(app).get('/extras/app_1/recruiter');
    expect(recruiter.status).toBe(200);
    expect(recruiter.text).toContain('Mensagem para o recrutador.');

    const unknown = await request(app).get('/extras/app_1/unknown');
    expect(unknown.status).toBe(404);
  });

  it('expõe base-resumes, pdf-theme e candidate-data no formato v1', async () => {
    const base = await request(app).get('/api/base-resumes');
    expect(base.status).toBe(200);
    expect(base.body['pt-br'].exists).toBe(true);
    expect(base.body['pt-br'].preview).toContain('Currículo base');
    expect(base.body['php-en'].exists).toBe(false);

    const theme = await request(app)
      .put('/api/pdf-theme')
      .send({ ruby: { accent: '#ff0000' }, cssVersion: 'b2' });
    expect(theme.status).toBe(200);
    expect(theme.body.theme.ruby.accent).toBe('#FF0000');

    const invalidTheme = await request(app)
      .put('/api/pdf-theme')
      .send({ ruby: { accent: 'vermelho' } });
    expect(invalidTheme.status).toBe(400);

    const candidate = await request(app)
      .put('/api/candidate-data')
      .send({ fullName: 'Horecio Dias', email: 'horecio@example.com' });
    expect(candidate.status).toBe(200);
    expect(candidate.body.candidate.firstName).toBe('Horecio');
    expect(candidate.body.candidate.lastName).toBe('Dias');

    const readCandidate = await request(app).get('/api/candidate-data');
    expect(readCandidate.body.candidate.email).toBe('horecio@example.com');
  });

  it('expõe profiles e settings genéricos', async () => {
    const profiles = await request(app).get('/api/profiles');
    expect(profiles.status).toBe(200);
    expect(profiles.body).toHaveLength(1);

    const profile = await request(app).get('/api/profiles/ruby/pt-br');
    expect(profile.status).toBe(200);
    expect(profile.body.stack).toBe('ruby');

    const put = await request(app)
      .put('/api/settings/minha_chave')
      .send({ value: { a: 1 } });
    expect(put.status).toBe(200);

    const get = await request(app).get('/api/settings/minha_chave');
    expect(get.status).toBe(200);
    expect(get.body.value).toEqual({ a: 1 });

    const missing = await request(app).get('/api/settings/inexistente');
    expect(missing.status).toBe(404);
  });

  it('responde 404 em rota desconhecida', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Rota não encontrada');
  });
});
