import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import type { Job } from '../src/domain/job.js';
import { createTestStore } from './helpers.js';

/**
 * Manual apply confirmation (D1): the app never submits a form on its own, so
 * the user must explicitly answer `approved: true` to mark the job as applied.
 */

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  ctx = createTestStore();
  app = createApp({ store: ctx.store });
});

afterEach(() => {
  ctx.cleanup();
});

function seed(overrides: Partial<Parameters<typeof ctx.store.jobs.create>[0]> = {}): Job {
  return ctx.store.jobs.create({
    company: 'Acme',
    role: 'Rails Engineer',
    language: 'en',
    stack: 'ruby',
    channel: 'linkedin',
    ...overrides,
  });
}

function validate(response: request.Response): void {
  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
  expect(response.body.job.status).toBe('applied');
}

describe('POST /api/jobs/:id/apply-confirm', () => {
  it('404 for an unknown job', async () => {
    const response = await request(app)
      .post('/api/jobs/app_missing/apply-confirm')
      .send({ approved: true });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Vaga não encontrada');
  });

  it('400 without an explicit approval and never touches the job', async () => {
    const job = seed();

    const omitted = await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ note: 'applied' });
    expect(omitted.status).toBe(400);
    expect(omitted.body.error).toMatch(/approved: true/i);

    const denied = await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ approved: false });
    expect(denied.status).toBe(400);

    expect(ctx.store.jobs.get(job.id)?.status).toBe('drafted');
    expect(ctx.store.jobs.get(job.id)?.appliedAt).toBeNull();
  });

  it('marks the job as applied with the sane defaults', async () => {
    const job = seed();
    const before = Date.now();

    const response = await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ approved: true });

    validate(response);

    const saved = ctx.store.jobs.get(job.id) as Job;
    expect(saved.status).toBe('applied');
    expect(saved.applyMethod).toBe('manual');
    expect(saved.channel).toBe('linkedin');
    expect(saved.applyNote).toBe('');
    expect(saved.appliedEmails).toEqual([]);
    expect(saved.appliedAt).not.toBeNull();
    expect(Date.parse(saved.appliedAt as string)).toBeGreaterThanOrEqual(before);
    expect(new Date(saved.appliedAt as string).toISOString()).toBe(saved.appliedAt);
  });

  it('sanitizes the channel, the note and the e-mails', async () => {
    const job = seed();
    const longChannel = 'LinkedIn Recruiter Campaign Extra Long Name';

    const response = await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({
        approved: true,
        channel: longChannel,
        note: '  Applied through the recruiter form.  ',
        appliedEmails: [' a@example.com ', 'a@example.com', 'b@example.com', ''],
      });

    validate(response);

    const saved = ctx.store.jobs.get(job.id) as Job;
    expect(saved.channel).toBe(longChannel.toLowerCase().slice(0, 30));
    expect(saved.channel).toHaveLength(30);
    expect(saved.applyNote).toBe('  Applied through the recruiter form.  ');
    expect(saved.appliedEmails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('accepts a comma/semicolon separated e-mail string and caps at 10', async () => {
    const job = seed();
    const ten = Array.from({ length: 10 }, (_, index) => `user${index}@example.com`);

    const response = await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ approved: true, appliedEmails: [...ten, 'extra@example.com'].join('; ') });

    validate(response);
    expect(ctx.store.jobs.get(job.id)?.appliedEmails).toHaveLength(10);
    expect(ctx.store.jobs.get(job.id)?.appliedEmails).toEqual(ten);
  });

  it('keeps at most 10 e-mails when the array overflows', async () => {
    const job = seed();

    await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({
        approved: true,
        appliedEmails: Array.from({ length: 12 }, (_, index) => `u${index}@example.com`),
      });

    const saved = ctx.store.jobs.get(job.id) as Job;
    expect(saved.appliedEmails).toHaveLength(10);
    expect(saved.appliedEmails[9]).toBe('u9@example.com');
  });

  it('truncates the note at 500 characters', async () => {
    const job = seed();

    await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ approved: true, note: 'x'.repeat(600) });

    const saved = ctx.store.jobs.get(job.id) as Job;
    expect(saved.applyNote).toHaveLength(500);
    expect(saved.applyNote).toBe('x'.repeat(500));
  });

  it('falls back to portal when neither body nor job define a channel', async () => {
    const job = seed({ channel: null });

    await request(app)
      .post(`/api/jobs/${job.id}/apply-confirm`)
      .send({ approved: true });

    expect(ctx.store.jobs.get(job.id)?.channel).toBe('portal');
  });
});

describe('POST /api/applications/:id/apply-confirm (legacy shim)', () => {
  it('answers the v1 shape and writes the same job columns', async () => {
    const job = seed();

    const response = await request(app)
      .post(`/api/applications/${job.id}/apply-confirm`)
      .send({
        approved: true,
        note: 'Applied via the legacy UI.',
        channel: 'Recruiter',
        appliedEmails: 'a@example.com, b@example.com',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.application).toMatchObject({
      id: job.id,
      status: 'applied',
      applyMethod: 'manual',
      applyNote: 'Applied via the legacy UI.',
      channel: 'recruiter',
      appliedEmails: ['a@example.com', 'b@example.com'],
    });
    expect(response.body.application.date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    const saved = ctx.store.jobs.get(job.id) as Job;
    expect(saved.status).toBe('applied');
    expect(saved.appliedAt).not.toBeNull();
    expect(saved.applyMethod).toBe('manual');
    expect(saved.applyNote).toBe('Applied via the legacy UI.');
    expect(saved.appliedEmails).toEqual(['a@example.com', 'b@example.com']);
  });

  it('keeps the v1 gates: 404 unknown and 400 without approval', async () => {
    const missing = await request(app)
      .post('/api/applications/app_missing/apply-confirm')
      .send({ approved: true });
    expect(missing.status).toBe(404);

    const job = seed();
    const denied = await request(app)
      .post(`/api/applications/${job.id}/apply-confirm`)
      .send({ approved: false });
    expect(denied.status).toBe(400);
    expect(ctx.store.jobs.get(job.id)?.status).toBe('drafted');
  });
});
