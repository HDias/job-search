import { afterEach, describe, expect, it } from 'vitest';
import {
  getCandidateFileSlug,
  sanitizeName,
  shortRoleFileSlug,
} from '../src/pipeline/kit/slug.js';
import { createTestStore } from './helpers.js';

let ctx: ReturnType<typeof createTestStore> | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

describe('getCandidateFileSlug', () => {
  it('falls back to Horecio-Dias when candidate_form is absent', () => {
    ctx = createTestStore();
    expect(getCandidateFileSlug(ctx.store)).toBe('Horecio-Dias');
  });

  it('builds the slug from the first and last name in candidate_form', () => {
    ctx = createTestStore();
    ctx.store.settings.set('candidate_form', {
      fullName: 'Horecio Araujo Dias',
    });
    expect(getCandidateFileSlug(ctx.store)).toBe('Horecio-Dias');
  });

  it('removes illegal characters and falls back when the name is blank', () => {
    ctx = createTestStore();
    ctx.store.settings.set('candidate_form', { fullName: "Ana María O'Neil" });
    expect(getCandidateFileSlug(ctx.store)).toBe('Ana-ONeil');

    ctx.store.settings.set('candidate_form', { fullName: '   ' });
    expect(getCandidateFileSlug(ctx.store)).toBe('Horecio-Dias');
  });
});

describe('sanitizeName', () => {
  it('lowercases, strips accents and collapses separators', () => {
    expect(sanitizeName('Acme Corp. (Brasil)')).toBe('acme_corp_brasil');
  });

  it('falls back to item and truncates to 40 characters', () => {
    expect(sanitizeName(null)).toBe('item');
    expect(sanitizeName('x'.repeat(80))).toHaveLength(40);
  });
});

describe('shortRoleFileSlug', () => {
  it('drops stopwords, title-cases and hyphenates the role', () => {
    expect(shortRoleFileSlug('Senior Software Engineer (Ruby on Rails)')).toBe(
      'Software-Engineer-Ruby-Rails',
    );
  });

  it('limits the slug to five words', () => {
    expect(shortRoleFileSlug('aa bb cc dd ee ff gg')).toBe('Aa-Bb-Cc-Dd-Ee');
  });

  it('falls back to Resume for an empty role', () => {
    expect(shortRoleFileSlug('')).toBe('Resume');
  });
});
