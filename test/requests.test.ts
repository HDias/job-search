import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Store } from '../src/repositories/types.js';
import { createTestStore } from './helpers.js';

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;
let applicationsDir: string;

function write(relative: string, content: string): void {
  const target = path.join(applicationsDir, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function seed(store: Store): void {
  store.jobs.create({
    id: 'app_req',
    company: 'Acme',
    role: 'Backend Engineer',
    language: 'en',
    stack: 'ruby',
    channel: 'linkedin',
    status: 'applied',
    appliedAt: '2026-10-28T12:00:00.000Z',
    vacancyUrl: 'https://example.com/acme',
    fit: {
      rating: 72,
      analysis: 'Boa aderência.',
      dimensions: { skillsMatch: 70, experienceMatch: 80 },
      strengths: ['Ruby'],
      gaps: ['Kubernetes'],
    },
    hasQuestions: true,
    hasRecruiterMessage: true,
  });

  store.jobs.create({
    id: 'app_second',
    company: 'Beta',
    role: 'Frontend Engineer',
    language: 'pt-br',
    status: 'drafted',
  });

  store.jobs.create({
    id: 'app_third',
    company: 'Gama',
    role: 'Platform Engineer',
    language: 'pt-br',
    status: 'interview',
    appliedAt: '2026-09-01T09:00:00.000Z',
  });

  store.runs.create({
    id: 'proc_req',
    jobId: 'app_req',
    stage: 'processing',
    url: 'https://example.com/acme',
    stack: 'ruby',
    jobSnapshot: {
      title: 'Backend Engineer',
      company: 'Acme',
      content: 'Descrição da vaga da Acme.',
    },
  });

  store.runs.create({
    id: 'proc_done',
    jobId: 'app_req',
    stage: 'done',
  });

  write('acme/curriculo.html', '<!DOCTYPE html><html><body><h1>Currículo</h1></body></html>');
  write('acme/curriculo.pdf', 'PDF');
  write('acme/email.txt', 'Olá, segue meu currículo.');
  write('acme/recrutador.txt', 'Mensagem ao recrutador.');
  write('acme/application_questions.json', '{"pergunta":"Por que a Acme?"}');
  write('acme/materiais_extras/sugestoes_respostas.md', '# Sugestões\n\nFale sobre Ruby.');
  write('beta/questions.json', '{"q":"Tem disponibilidade?"}');

  store.artifacts.addMany([
    { jobId: 'app_req', runId: 'proc_req', kind: 'cv_html', relativePath: 'acme/curriculo.html', mime: 'text/html' },
    { jobId: 'app_req', runId: 'proc_req', kind: 'cv_pdf', relativePath: 'acme/curriculo.pdf', mime: 'application/pdf' },
    { jobId: 'app_req', runId: 'proc_req', kind: 'email_text', relativePath: 'acme/email.txt', mime: 'text/plain' },
    { jobId: 'app_req', runId: 'proc_req', kind: 'recruiter_note', relativePath: 'acme/recrutador.txt', mime: 'text/plain' },
    { jobId: 'app_req', runId: 'proc_req', kind: 'questions', relativePath: 'acme/application_questions.json', mime: 'application/json' },
    { jobId: 'app_req', runId: 'proc_req', kind: 'suggestions', relativePath: 'acme/materiais_extras/sugestoes_respostas.md', mime: 'text/markdown' },
    { jobId: 'app_second', kind: 'questions', relativePath: 'beta/questions.json', mime: 'application/json' },
  ]);
}

beforeEach(() => {
  ctx = createTestStore();
  applicationsDir = path.join(ctx.dir, 'applications');
  seed(ctx.store);
  app = createApp({ store: ctx.store, applicationsDir });
});

afterEach(() => {
  ctx.cleanup();
});

describe('requests: vagas', () => {
  it('responde lista vazia e stats zerados em um banco novo', async () => {
    const empty = createTestStore();
    try {
      const emptyApp = createApp({ store: empty.store });

      const list = await request(emptyApp).get('/api/jobs');
      expect(list.status).toBe(200);
      expect(list.body).toEqual({ items: [], total: 0 });

      const stats = await request(emptyApp).get('/api/stats');
      expect(stats.status).toBe(200);
      expect(stats.body).toEqual({
        total: 0,
        byStatus: {},
        averageFitRating: null,
        appliedLast30Days: 0,
      });
    } finally {
      empty.cleanup();
    }
  });

  it('filtra por busca textual e por status', async () => {
    const byQuery = await request(app).get('/api/jobs?q=acme');
    expect(byQuery.status).toBe(200);
    expect(byQuery.body.total).toBe(1);
    expect(byQuery.body.items[0].id).toBe('app_req');

    const byStatus = await request(app).get('/api/jobs?status=interview');
    expect(byStatus.body.total).toBe(1);
    expect(byStatus.body.items[0].company).toBe('Gama');

    const noMatch = await request(app).get('/api/jobs?q=inexistente');
    expect(noMatch.body).toEqual({ items: [], total: 0 });
  });

  it('pagina e ignora limit inválido', async () => {
    const page = await request(app).get('/api/jobs?limit=1&offset=1');
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].company).toBe('Gama');

    const fallback = await request(app).get('/api/jobs?limit=abc');
    expect(fallback.status).toBe(200);
    expect(fallback.body.items).toHaveLength(3);
  });

  it('rejeita status inválido na listagem', async () => {
    const res = await request(app).get('/api/jobs?status=inexistente');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status inválido/);
  });

  it('devolve o agregado da vaga e 404 quando não existe', async () => {
    const res = await request(app).get('/api/jobs/app_req');
    expect(res.status).toBe(200);
    expect(res.body.job.id).toBe('app_req');
    expect(res.body.runs).toHaveLength(2);
    expect(res.body.artifacts).toHaveLength(6);

    const missing = await request(app).get('/api/jobs/app_missing');
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('Vaga não encontrada');
  });

  it('cria vaga mínima com defaults', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ company: 'Nova', role: 'Dev' });

    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^app_/);
    expect(res.body.ownerId).toBe('local');
    expect(res.body.language).toBe('pt-br');
    expect(res.body.stack).toBe('ruby');
    expect(res.body.status).toBe('drafted');
    expect(res.body.appliedEmails).toEqual([]);
  });

  it('rejeita criação com data fora do ISO e campos vazios', async () => {
    const badDate = await request(app)
      .post('/api/jobs')
      .send({ company: 'Nova', role: 'Dev', appliedAt: '28/10/2026' });
    expect(badDate.status).toBe(400);
    expect(Array.isArray(badDate.body.details)).toBe(true);

    const empty = await request(app).post('/api/jobs').send({ company: '  ', role: 'Dev' });
    expect(empty.status).toBe(400);
  });

  it('atualiza parcialmente e remove a vaga', async () => {
    const patched = await request(app)
      .patch('/api/jobs/app_second')
      .send({ status: 'offer', fit: { rating: 91, strengths: ['CSS'], gaps: [] } });

    expect(patched.status).toBe(200);
    expect(patched.body.status).toBe('offer');
    expect(patched.body.fit.rating).toBe(91);
    // campos não enviados continuam intactos
    expect(patched.body.company).toBe('Beta');

    const removed = await request(app).delete('/api/jobs/app_third');
    expect(removed.status).toBe(204);
    expect((await request(app).get('/api/jobs/app_third')).status).toBe(404);
  });

  it('responde 404 e 400 em patch/delete inválidos', async () => {
    expect((await request(app).patch('/api/jobs/app_missing').send({ status: 'applied' })).status).toBe(404);
    expect((await request(app).delete('/api/jobs/app_missing')).status).toBe(404);
    expect((await request(app).patch('/api/jobs/app_req').send({ status: 'nope' })).status).toBe(400);
  });
});

describe('requests: runs', () => {
  it('filtra por vaga e por estágio', async () => {
    const byJob = await request(app).get('/api/runs?jobId=app_req');
    expect(byJob.status).toBe(200);
    expect(byJob.body).toHaveLength(2);

    const byStage = await request(app).get('/api/runs?jobId=app_req&stage=processing');
    expect(byStage.body).toHaveLength(1);
    expect(byStage.body[0].id).toBe('proc_req');
    expect(byStage.body[0].jobSnapshot.content).toBe('Descrição da vaga da Acme.');
  });

  it('cria, atualiza e remove um run', async () => {
    const created = await request(app)
      .post('/api/runs')
      .send({ jobId: 'app_req', stage: 'draft', stack: 'ruby' });

    expect(created.status).toBe(201);
    expect(created.body.id).toMatch(/^proc_/);
    expect(created.body.stage).toBe('draft');

    const patched = await request(app)
      .patch(`/api/runs/${created.body.id}`)
      .send({ stage: 'done', hasRawText: true });
    expect(patched.status).toBe(200);
    expect(patched.body.stage).toBe('done');
    expect(patched.body.hasRawText).toBe(true);

    const removed = await request(app).delete(`/api/runs/${created.body.id}`);
    expect(removed.status).toBe(204);
    expect((await request(app).get(`/api/runs/${created.body.id}`)).status).toBe(404);
  });

  it('rejeita corpo inválido e trata 404 em runs', async () => {
    expect((await request(app).post('/api/runs').send({ stage: '' })).status).toBe(400);
    expect((await request(app).get('/api/runs/proc_missing')).status).toBe(404);
    expect((await request(app).patch('/api/runs/proc_missing').send({ stage: 'done' })).status).toBe(404);
    expect((await request(app).delete('/api/runs/proc_missing')).status).toBe(404);
  });
});

describe('requests: metadados', () => {
  it('lista perfis base ausentes', async () => {
    const res = await request(app).get('/api/base-resumes');
    expect(res.status).toBe(200);
    expect(res.body['pt-br']).toEqual({ exists: false, language: 'pt-br' });
    expect(res.body['php-en']).toEqual({ exists: false, language: 'en' });
  });

  it('lê e atualiza o tema de PDF preservando o que não foi enviado', async () => {
    const initial = await request(app).get('/api/pdf-theme');
    expect(initial.body).toEqual({ success: true, theme: {} });

    const first = await request(app)
      .put('/api/pdf-theme')
      .send({ ruby: { accent: '#ff0000' }, php: { accentDark: '#00ff00' }, cssVersion: 'b2' });
    expect(first.status).toBe(200);
    expect(first.body.theme.ruby.accent).toBe('#FF0000');
    expect(first.body.theme.php.accentDark).toBe('#00FF00');

    const second = await request(app).put('/api/pdf-theme').send({ cssVersion: 'b3' });
    expect(second.status).toBe(200);
    expect(second.body.theme.cssVersion).toBe('b3');
    expect(second.body.theme.ruby.accent).toBe('#FF0000');
    expect(second.body.theme.php.accentDark).toBe('#00FF00');

    const invalid = await request(app).put('/api/pdf-theme').send({ ruby: { accent: 'vermelho' } });
    expect(invalid.status).toBe(400);
  });

  it('lê e atualiza os dados do formulário', async () => {
    const initial = await request(app).get('/api/candidate-data');
    expect(initial.body).toEqual({ success: true, candidate: {} });

    const updated = await request(app)
      .put('/api/candidate-data')
      .send({ fullName: 'Horecio Dias', email: 'horecio@example.com' });
    expect(updated.status).toBe(200);
    expect(updated.body.candidate.firstName).toBe('Horecio');
    expect(updated.body.candidate.lastName).toBe('Dias');

    const partial = await request(app).put('/api/candidate-data').send({ phone: '123' });
    expect(partial.body.candidate.fullName).toBe('Horecio Dias');
    expect(partial.body.candidate.phone).toBe('123');
  });

  it('faz upsert de perfis e valida o corpo', async () => {
    expect((await request(app).get('/api/profiles/php/en')).status).toBe(404);

    const put = await request(app)
      .put('/api/profiles/php/en')
      .send({ content: { rawText: 'PHP profile', rawLength: 11 } });
    expect(put.status).toBe(200);
    expect(put.body.stack).toBe('php');
    expect(put.body.language).toBe('en');

    const get = await request(app).get('/api/profiles/php/en');
    expect(get.status).toBe(200);
    expect(get.body.content.rawText).toBe('PHP profile');

    expect((await request(app).put('/api/profiles/php/en').send({})).status).toBe(400);

    const list = await request(app).get('/api/profiles');
    expect(list.body).toHaveLength(1);
  });

  it('gerencia settings genéricos e rejeita corpo sem value', async () => {
    expect((await request(app).get('/api/settings')).body).toEqual([]);

    const put = await request(app).put('/api/settings/minha_chave').send({ value: { a: 1 } });
    expect(put.status).toBe(200);
    expect(put.body.value).toEqual({ a: 1 });

    const get = await request(app).get('/api/settings/minha_chave');
    expect(get.body).toEqual({ key: 'minha_chave', value: { a: 1 } });

    const list = await request(app).get('/api/settings');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].key).toBe('minha_chave');

    expect((await request(app).put('/api/settings/outra').send({})).status).toBe(400);
    expect((await request(app).get('/api/settings/inexistente')).status).toBe(404);
  });
});

describe('requests: compatibilidade v1', () => {
  it('responde listas vazias em banco novo', async () => {
    const empty = createTestStore();
    try {
      const emptyApp = createApp({ store: empty.store });
      expect((await request(emptyApp).get('/api/applications')).body).toEqual([]);
      expect((await request(emptyApp).get('/api/processes')).body).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });

  it('mapeia artefatos para os campos legados', async () => {
    const res = await request(app).get('/api/applications');
    expect(res.status).toBe(200);

    const acme = res.body.find((item: { id: string }) => item.id === 'app_req');
    expect(acme.date).toBe('28/10/2026');
    expect(acme.cvHtmlFile).toBe('/applications/acme/curriculo.html');
    expect(acme.cvPdfFile).toBe('/applications/acme/curriculo.pdf');
    expect(acme.emailTextFile).toBe('/applications/acme/email.txt');
    expect(acme.questionsFile).toBe('/applications/acme/application_questions.json');
    expect(acme.suggestionsFile).toBe('/applications/acme/materiais_extras/sugestoes_respostas.md');
    expect(acme.recruiterNoteFile).toBe('/applications/acme/recrutador.txt');
    expect(acme.linkedInNoteFile).toBe('/applications/acme/recrutador.txt');
  });

  it('ignora status legado desconhecido e trata 404', async () => {
    const res = await request(app)
      .put('/api/applications/app_req')
      .send({ status: 'inexistente' });
    expect(res.status).toBe(200);
    expect(res.body.application.status).toBe('applied');

    expect((await request(app).put('/api/applications/app_missing').send({})).status).toBe(404);
    expect((await request(app).delete('/api/applications/app_missing')).status).toBe(404);
    expect((await request(app).put('/api/processes/proc_missing').send({})).status).toBe(404);
    expect((await request(app).delete('/api/processes/proc_missing')).status).toBe(404);
  });

  it('lista só checkpoints pendentes e permite desvincular a vaga', async () => {
    const processes = await request(app).get('/api/processes');
    expect(processes.status).toBe(200);
    expect(processes.body).toHaveLength(1);
    expect(processes.body[0].id).toBe('proc_req');

    const unlinked = await request(app)
      .put('/api/processes/proc_req')
      .send({ applicationId: null, stage: 'done' });
    expect(unlinked.status).toBe(200);
    expect(unlinked.body.process.applicationId).toBeNull();
    expect(unlinked.body.process.stage).toBe('done');
  });
});

describe('requests: visualizadores e estáticos', () => {
  it('serve o PDF e bloqueia path traversal', async () => {
    const pdf = await request(app).get('/applications/acme/curriculo.pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const traversal = await request(app).get('/applications/%2e%2e/%2e%2e/package.json');
    expect([403, 404]).toContain(traversal.status);
    expect(traversal.text).not.toContain('job-search-v2');
  });

  it('renderiza o currículo e avisa quando o arquivo não existe', async () => {
    const cv = await request(app).get('/cv/app_req');
    expect(cv.status).toBe(200);
    expect(cv.text).toContain('Acme');
    expect(cv.text).toContain('Baixar PDF');

    const missingFile = await request(app).get('/cv/app_second');
    expect(missingFile.status).toBe(404);
    expect(missingFile.text).toContain('não está disponível');

    expect((await request(app).get('/cv/app_missing')).status).toBe(404);
  });

  it('serve extras em texto e JSON formatado', async () => {
    const email = await request(app).get('/extras/app_req/email');
    expect(email.status).toBe(200);
    expect(email.text).toContain('Olá, segue meu currículo.');

    const suggestions = await request(app).get('/extras/app_req/suggestions');
    expect(suggestions.status).toBe(200);
    expect(suggestions.text).toContain('Fale sobre Ruby.');

    const questions = await request(app).get('/extras/app_second/suggestions');
    expect(questions.status).toBe(200);
    expect(questions.text).toContain('Tem disponibilidade?');
    expect(questions.text).toContain('&quot;q&quot;');

    expect((await request(app).get('/extras/app_req/unknown')).status).toBe(404);
  });

  it('avisa quando não há material para a visão', async () => {
    const res = await request(app).get('/extras/app_third/email');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Nenhum material registrado');
  });
});

describe('requests: SPA', () => {
  it('serve o build do React sem engolir 404 da API e dos artefatos', async () => {
    const dist = path.join(ctx.dir, 'web');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(
      path.join(dist, 'index.html'),
      '<!doctype html><html><body>SPA React</body></html>',
    );
    writeFileSync(path.join(dist, 'assets', 'app.js'), 'console.log("app");');

    const spaApp = createApp({
      store: ctx.store,
      applicationsDir,
      webDist: dist,
    });

    const root = await request(spaApp).get('/').set('Accept', 'text/html');
    expect(root.status).toBe(200);
    expect(root.text).toContain('SPA React');

    const navigation = await request(spaApp)
      .get('/jobs/app_req')
      .set('Accept', 'text/html');
    expect(navigation.status).toBe(200);
    expect(navigation.text).toContain('SPA React');

    const asset = await request(spaApp).get('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.text).toContain('console.log');

    const api = await request(spaApp).get('/api/nao-existe');
    expect(api.status).toBe(404);
    expect(api.body.error).toBe('Rota não encontrada');

    const missingArtifact = await request(spaApp)
      .get('/applications/nao-existe.pdf')
      .set('Accept', 'text/html');
    expect(missingArtifact.status).toBe(404);
    expect(missingArtifact.text).not.toContain('SPA React');
  });
});

describe('requests: erros de transporte', () => {
  it('responde 404 em rota desconhecida', async () => {
    const res = await request(app).get('/api/nao-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Rota não encontrada', path: '/api/nao-existe' });
  });

  it('responde 400 para JSON malformado', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .set('Content-Type', 'application/json')
      .send('{"company":');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON inválido/);
  });

  it('responde 413 para corpo acima do limite', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ company: 'Acme', role: 'Dev', coverLetterGuidance: 'x'.repeat(5 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/muito grande/);
  });

  it('responde 400 para formulário sem os campos obrigatórios', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .type('form')
      .send({ company: 'Acme' });
    expect(res.status).toBe(400);
  });
});
