import { describe, expect, it } from 'vitest';
import type { Artifact } from '../api/types';
import {
  artifactHref,
  artifactLabel,
  fitTone,
  formatBytes,
  formatDate,
  formatFit,
} from './format';

function artifact(kind: string, relativePath = 'x/file'): Artifact {
  return {
    id: 'art_1',
    jobId: 'app_1',
    runId: null,
    kind,
    relativePath,
    mime: null,
    sizeBytes: null,
    createdAt: '2026-10-28T12:00:00.000Z',
  };
}

describe('format', () => {
  it('formata datas ISO e trata valores ausentes', () => {
    expect(formatDate('2026-10-28T12:00:00.000Z')).toBe('28/10/2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('inválida')).toBe('—');
  });

  it('formata fit e bytes', () => {
    expect(formatFit(69.9)).toBe('70%');
    expect(formatFit(null)).toBe('—');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(0)).toBe('');
  });

  it('classifica o tom do fit', () => {
    expect(fitTone(90)).toBe('high');
    expect(fitTone(70)).toBe('mid');
    expect(fitTone(40)).toBe('low');
    expect(fitTone(undefined)).toBe('none');
  });

  it('aponta cada artefato para o visualizador correto', () => {
    expect(artifactHref('app_1', artifact('cv_pdf'))).toBe('/cv/app_1');
    expect(artifactHref('app_1', artifact('email_text'))).toBe('/extras/app_1/email');
    expect(artifactHref('app_1', artifact('recruiter_note'))).toBe('/extras/app_1/recruiter');
    expect(artifactHref('app_1', artifact('questions'))).toBe('/extras/app_1/suggestions');
    expect(artifactHref('app_1', artifact('job_posting', 'acme/vaga.txt'))).toBe(
      '/applications/acme/vaga.txt',
    );
  });

  it('rotula tipos conhecidos e desconhecidos', () => {
    expect(artifactLabel('cv_pdf')).toBe('Currículo (PDF)');
    expect(artifactLabel('kind_novo')).toBe('kind_novo');
  });
});
