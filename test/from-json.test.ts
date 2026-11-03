import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore } from '../src/repositories/sqlite/store.js';
import {
  importFromJson,
  parseLegacyDate,
} from '../src/migrations/from-json.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'job-search-v2-import-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function writeFixtures(): {
  trackerFile: string;
  processesFile: string;
  applicationsDir: string;
  baseProfileDir: string;
  dbFile: string;
} {
  const trackerFile = path.join(dir, 'job_search_tracker.json');
  const processesFile = path.join(dir, 'job_processes.json');
  const applicationsDir = path.join(dir, 'applications');
  const baseProfileDir = path.join(dir, 'base_profile');
  const dbFile = path.join(dir, 'data', 'job-search.db');

  writeJson(trackerFile, [
    {
      id: 'app_1',
      date: '28/10/2026',
      company: 'Andela',
      role: 'Senior Backend Software Engineer',
      language: 'en',
      languageConfirmation: 'user-confirmed',
      stack: 'ruby',
      channel: 'linkedin',
      fitRating: 77.5,
      fitAnalysis: 'Forte aderência em Ruby on Rails.',
      fitDimensions: {
        skillsMatch: 60,
        experienceMatch: 85,
        logisticsMatch: 95,
        cultureMatch: 90,
      },
      strengths: ['Rails', 'PostgreSQL'],
      gaps: ['Node.js'],
      eligibility: { passed: true, reason: 'Trabalho remoto.' },
      languageGate: { required: 'en', passed: true, note: 'Inglês profissional.' },
      logisticsNote: null,
      skillGrounded: true,
      fitConfirmed: true,
      status: 'applied',
      vacancyUrl: 'https://example.com/job/1',
      applyUrl: '',
      cvHtmlFile: '/applications/acme/curriculo.html',
      cvPdfFile: '/applications/acme/curriculo.pdf',
      emailTextFile: '/applications/acme/email.txt',
      hasRecruiterMessage: true,
      hasQuestions: false,
      createdAt: '2026-10-28T03:28:35.606Z',
      updatedAt: '2026-10-28T03:31:04.723Z',
    },
    {
      id: 'app_2',
      date: '01/02/2026',
      company: 'Beta',
      role: 'Frontend Engineer',
      language: 'pt-br',
      stack: 'php',
      status: 'drafted',
      createdAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
    },
  ]);

  writeJson(processesFile, [
    {
      id: 'proc_1',
      applicationId: 'app_1',
      stage: 'done',
      url: 'https://example.com/job/1',
      stack: 'ruby',
      hasRawText: true,
      hasExtraQuestions: true,
      hasRecruiterMessage: true,
      languagePreference: 'en',
      detectedLanguage: 'en',
      suggestedLanguage: 'en',
      needsLanguageConfirmation: false,
      needsFitConfirmation: false,
      eligibilityBlocked: false,
      job: {
        title: 'Senior Backend Software Engineer',
        company: 'Andela',
        location: 'Remote',
        url: 'https://example.com/job/1',
        applyUrl: 'https://example.com/job/1/apply',
        detectedLanguage: 'en',
      },
      jobSnapshot: {
        title: 'Senior Backend Software Engineer',
        company: 'Andela',
        location: 'Remote',
        url: 'https://example.com/job/1',
        applyUrl: 'https://example.com/job/1/apply',
        detectedLanguage: 'en',
        content: 'Texto completo da vaga.',
        extraQuestions: 'Você tem disponibilidade?',
        recruiterMessage: 'Mensagem do recrutador.',
      },
      fit: {
        fitRating: 80,
        fitAnalysis: 'Boa aderência.',
        skillsMatch: 90,
        experienceMatch: 85,
        logisticsMatch: 100,
        cultureMatch: 80,
        strengths: ['Rails'],
        gaps: ['Node.js'],
        eligibility: { passed: true, reason: 'Remoto.' },
        languageGate: { required: 'en', passed: true, note: null },
      },
      createdAt: '2026-10-28T03:29:00.000Z',
      updatedAt: '2026-10-28T03:31:00.000Z',
    },
    {
      id: 'proc_2',
      stage: 'fit-checked',
      url: 'https://outra-vaga.test/job/9',
      job: {
        title: 'Platform Engineer',
        company: 'Outra Empresa',
        location: 'Latin America',
      },
      createdAt: '2026-10-29T03:29:00.000Z',
      updatedAt: '2026-10-29T03:29:00.000Z',
    },
  ]);

  mkdirSync(path.join(applicationsDir, 'acme'), { recursive: true });
  writeFileSync(path.join(applicationsDir, 'acme', 'curriculo.pdf'), 'PDF');
  writeFileSync(
    path.join(applicationsDir, 'acme', 'curriculo.html'),
    '<html></html>',
  );
  writeFileSync(path.join(applicationsDir, 'acme', 'email.txt'), 'Olá');

  writeJson(path.join(baseProfileDir, 'perfil_base_pt_br.json'), {
    name: 'Horecio',
  });
  writeJson(path.join(baseProfileDir, 'pdf-theme.json'), { accent: '#0af' });
  writeJson(path.join(baseProfileDir, 'config.json'), {
    provider: 'gemini',
    apiKey: 'segredo',
  });

  return {
    trackerFile,
    processesFile,
    applicationsDir,
    baseProfileDir,
    dbFile,
  };
}

function inspect(dbFile: string, fn: (store: ReturnType<typeof createStore>) => void): void {
  const store = createStore(dbFile);
  try {
    fn(store);
  } finally {
    store.close();
  }
}

describe('parseLegacyDate', () => {
  it('converte dd/mm/yyyy para ISO ao meio-dia UTC', () => {
    expect(parseLegacyDate('28/10/2026')).toBe('2026-10-28T12:00:00.000Z');
    expect(parseLegacyDate('01/02/2026')).toBe('2026-02-01T12:00:00.000Z');
  });

  it('aceita ISO e rejeita datas inválidas ou vazias', () => {
    expect(parseLegacyDate('2026-10-28T03:28:35.606Z')).toBe(
      '2026-10-28T03:28:35.606Z',
    );
    expect(parseLegacyDate('31/02/2026')).toBeNull();
    expect(parseLegacyDate('')).toBeNull();
    expect(parseLegacyDate(null)).toBeNull();
    expect(parseLegacyDate('não é data')).toBeNull();
  });
});

describe('importFromJson', () => {
  it('importa vagas, processos, artefatos, perfis e settings', () => {
    const files = writeFixtures();
    const report = importFromJson(files);

    expect(report.jobs).toBe(2);
    expect(report.runs).toBe(2);
    expect(report.runsWithoutJob).toBe(1);
    expect(report.artifacts).toBe(3);
    expect(report.profiles).toBe(1);
    expect(report.settings).toBe(1);
    expect(report.warnings.join('\n')).toContain('config.json');

    inspect(files.dbFile, (store) => {
      const job = store.jobs.get('app_1');
      expect(job).not.toBeNull();
      expect(job?.company).toBe('Andela');
      expect(job?.language).toBe('en');
      expect(job?.languageConfirmation).toBe('user-confirmed');
      expect(job?.stack).toBe('ruby');
      expect(job?.status).toBe('applied');
      expect(job?.appliedAt).toBe('2026-10-28T12:00:00.000Z');
      expect(job?.fit?.rating).toBe(77.5);
      expect(job?.fit?.dimensions).toEqual({
        skillsMatch: 60,
        experienceMatch: 85,
        logisticsMatch: 95,
        cultureMatch: 90,
      });
      expect(job?.fit?.strengths).toEqual(['Rails', 'PostgreSQL']);
      expect(job?.fit?.eligibility).toEqual({
        passed: true,
        reason: 'Trabalho remoto.',
      });
      expect(job?.skillGrounded).toBe(true);
      expect(job?.fitConfirmed).toBe(true);
      expect(job?.createdAt).toBe('2026-10-28T03:28:35.606Z');
      expect(job?.updatedAt).toBe('2026-10-28T03:31:04.723Z');

      // applyUrl vazio vira null, não string vazia
      expect(job?.applyUrl).toBeNull();

      const secondJob = store.jobs.get('app_2');
      expect(secondJob?.appliedAt).toBe('2026-02-01T12:00:00.000Z');
      expect(secondJob?.stack).toBe('php');

      const artifacts = store.artifacts.listByJob('app_1');
      expect(artifacts).toHaveLength(3);
      const pdf = artifacts.find((artifact) => artifact.kind === 'cv_pdf');
      expect(pdf?.relativePath).toBe('acme/curriculo.pdf');
      expect(pdf?.mime).toBe('application/pdf');
      expect(pdf?.sizeBytes).toBe(3);
      expect(artifacts.every((artifact) => artifact.runId === null)).toBe(true);

      const runs = store.runs.list();
      const linked = runs.find((run) => run.id === 'proc_1');
      expect(linked?.jobId).toBe('app_1');
      expect(linked?.stage).toBe('done');
      expect(linked?.fit?.rating).toBe(80);
      expect(linked?.fit?.dimensions?.skillsMatch).toBe(90);
      expect(linked?.stack).toBe('ruby');
      expect(linked?.job?.title).toBe('Senior Backend Software Engineer');
      expect(linked?.jobSnapshot?.title).toBe('Senior Backend Software Engineer');
      expect(linked?.jobSnapshot?.location).toBe('Remote');
      expect(linked?.jobSnapshot?.content).toBe('Texto completo da vaga.');
      expect(linked?.jobSnapshot?.extraQuestions).toBe('Você tem disponibilidade?');
      expect(linked?.jobSnapshot?.recruiterMessage).toBe('Mensagem do recrutador.');

      const orphan = runs.find((run) => run.id === 'proc_2');
      expect(orphan?.jobId).toBeNull();
      expect(orphan?.jobSnapshot?.company).toBe('Outra Empresa');

      expect(store.profiles.get('ruby', 'pt-br')?.content).toEqual({
        name: 'Horecio',
      });
      expect(store.settings.get('pdf_theme')).toEqual({ accent: '#0af' });
      // config.json (com apiKey) não deve ser importado
      expect(store.settings.get('config')).toBeNull();
    });
  });

  it('recusa importar duas vezes sem --reset e permite com --reset', () => {
    const files = writeFixtures();
    importFromJson(files);

    expect(() => importFromJson(files)).toThrow(/já contém vagas/);

    const report = importFromJson({ ...files, reset: true });
    expect(report.jobs).toBe(2);
    expect(report.runs).toBe(2);

    inspect(files.dbFile, (store) => {
      expect(store.jobs.list().total).toBe(2);
      expect(store.runs.list()).toHaveLength(2);
      expect(store.profiles.list()).toHaveLength(1);
    });
  });

  it('normaliza status legado e sinaliza data inválida', () => {
    const trackerFile = path.join(dir, 'tracker.json');
    const dbFile = path.join(dir, 'invalid.db');

    writeJson(trackerFile, [
      {
        id: 'app_x',
        date: '31/02/2026',
        company: 'Legado',
        role: 'Dev',
        status: 'encerrado',
      },
      {
        id: 'app_y',
        company: 'Legado 2',
        role: 'Dev',
        status: 'status-inexistente',
      },
    ]);

    const report = importFromJson({ trackerFile, dbFile });

    expect(report.warnings.join('\n')).toContain('Data inválida');
    expect(report.warnings.join('\n')).toContain('status-inexistente');

    inspect(dbFile, (store) => {
      expect(store.jobs.get('app_x')?.status).toBe('rejected');
      expect(store.jobs.get('app_x')?.appliedAt).toBeNull();
      expect(store.jobs.get('app_y')?.status).toBe('drafted');
    });
  });

  it('rejeita tracker que não é um array', () => {
    const trackerFile = path.join(dir, 'bad.json');
    writeJson(trackerFile, { not: 'an array' });

    expect(() =>
      importFromJson({ trackerFile, dbFile: path.join(dir, 'bad.db') }),
    ).toThrow(/Tracker inválido/);
  });
});
