import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/api/app.js';
import { extractCandidateFromTexts } from '../src/pipeline/candidate-data.js';
import { createTestStore } from './helpers.js';

/**
 * v1 parity for `GET /api/candidate-data`: contact fields are derived from the
 * base resume text and the saved `candidate_form` fills whatever is missing.
 */

const RESUME = `Horecio Araujo Dias
Engenheiro de Software
horecio.dias@example.com · +55 (11) 98888-7777
linkedin.com/in/horeciodias
github.com/horeciodias

Principais competências
Ruby, Rails, PostgreSQL`;

let ctx: ReturnType<typeof createTestStore>;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  ctx = createTestStore();
  app = createApp({ store: ctx.store });
});

afterEach(() => {
  ctx.cleanup();
});

describe('extractCandidateFromTexts', () => {
  it('extracts e-mail, phone, LinkedIn, GitHub and the name from the header', () => {
    expect(extractCandidateFromTexts([RESUME])).toEqual({
      fullName: 'Horecio Araujo Dias',
      firstName: 'Horecio',
      lastName: 'Araujo Dias',
      email: 'horecio.dias@example.com',
      phone: '+55 (11) 98888-7777',
      linkedin: 'https://www.linkedin.com/in/horeciodias',
      github: 'https://github.com/horeciodias',
      portfolio: '',
    });
  });

  it('skips section headings and role titles when guessing the name', () => {
    const text = `Principais competências
Engenheiro de Software
contato@example.com`;

    expect(extractCandidateFromTexts([text]).fullName).toBe('');
  });

  it('keeps the first value found across profiles', () => {
    const second = 'Outra Pessoa\noutra@example.com\nCurrículo';

    const result = extractCandidateFromTexts([RESUME, second]);
    expect(result.email).toBe('horecio.dias@example.com');
    expect(result.fullName).toBe('Horecio Araujo Dias');
  });
});

describe('GET /api/candidate-data', () => {
  it('derives the candidate from the base resume and keeps saved fields', async () => {
    ctx.store.profiles.upsert({
      stack: 'ruby',
      language: 'pt-br',
      content: { rawText: RESUME },
    });
    ctx.store.settings.set('candidate_form', {
      portfolio: 'https://horecio.dev',
      phone: '',
    });

    const response = await request(app).get('/api/candidate-data');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.candidate).toMatchObject({
      fullName: 'Horecio Araujo Dias',
      firstName: 'Horecio',
      lastName: 'Araujo Dias',
      email: 'horecio.dias@example.com',
      phone: '+55 (11) 98888-7777',
      linkedin: 'https://www.linkedin.com/in/horeciodias',
      github: 'https://github.com/horeciodias',
      portfolio: 'https://horecio.dev',
    });
  });

  it('falls back to the saved form when no resume text exists', async () => {
    ctx.store.settings.set('candidate_form', {
      fullName: 'Horecio Dias',
      email: 'saved@example.com',
    });

    const response = await request(app).get('/api/candidate-data');

    expect(response.body.candidate).toMatchObject({
      fullName: 'Horecio Dias',
      email: 'saved@example.com',
    });
  });

  it('returns the empty shape when there is neither resume nor form', async () => {
    const response = await request(app).get('/api/candidate-data');

    expect(response.body.candidate).toEqual({
      fullName: '',
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      linkedin: '',
      github: '',
      portfolio: '',
    });
  });
});
