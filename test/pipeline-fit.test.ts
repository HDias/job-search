import { describe, expect, it } from 'vitest';
import {
  analyzeProfile,
  classifyRequirements,
  extractCoverageTerms,
  getProfileSection,
} from '../src/pipeline/fit/profile.js';
import { calculateFitHybrid } from '../src/pipeline/fit/index.js';

const BASE =
  'Senior Ruby on Rails engineer. RSpec and FactoryBot with TDD. Docker environments. Datadog monitoring. Mentored juniors. React Native mobile collaboration in 2015.';
const JOB =
  'Senior Ruby on Rails. RSpec and FactoryBot required. Docker and Terraform. Mentoring juniors. React frontend.';

const CV_WITH_DATES = `Jane Doe
Senior Software Engineer
Acme Corp
January 2019 - Present
Built Ruby on Rails APIs with PostgreSQL, Sidekiq and RSpec in production.
Mentored juniors and led code reviews.

Software Engineer
Beta Ltd
March 2016 - December 2018
Worked with Ruby, Docker and AWS. Improved performance and monitoring with Datadog.

Education
BSc Computer Science`;

describe('extractCoverageTerms (v1 parity)', () => {
  it('puts genuine matches in mustCover', () => {
    const coverage = extractCoverageTerms(JOB, BASE);
    const terms = coverage.mustCover.map((entry) => entry.term);
    expect(terms).toContain('FactoryBot');
    expect(terms).toContain('Docker');
    expect(terms).toContain('RSpec');
  });

  it('puts a proper noun missing from the base in forbidden', () => {
    const coverage = extractCoverageTerms(JOB, BASE);
    expect(coverage.forbidden.map((entry) => entry.term)).toContain('Terraform');
  });

  it('excludes React from coverage', () => {
    const coverage = extractCoverageTerms(JOB, BASE);
    const all = [...coverage.mustCover, ...coverage.forbidden].map(
      (entry) => entry.term,
    );
    expect(all).not.toContain('React');
  });

  it('keeps base snippets for evidence', () => {
    const coverage = extractCoverageTerms(JOB, BASE);
    const factory = coverage.mustCover.find(
      (entry) => entry.term === 'FactoryBot',
    );
    expect(factory?.baseSnippet?.length).toBeGreaterThan(10);
  });
});

describe('analyzeProfile', () => {
  it('computes duration, stacks and evidence deterministically', () => {
    const profile = analyzeProfile(CV_WITH_DATES);

    expect(profile.jobs).toBeGreaterThanOrEqual(2);
    expect(profile.totalMonths).toBeGreaterThan(24);
    expect(profile.stacks.Rails?.months).toBeGreaterThan(0);
    expect(profile.stacks.Docker?.months).toBeGreaterThan(0);
    expect(profile.evidence.length).toBeGreaterThan(0);
    expect(getProfileSection(CV_WITH_DATES)).toContain('Carreira dev:');
  });

  it('returns an empty profile for empty input', () => {
    const profile = analyzeProfile('');
    expect(profile.jobs).toBe(0);
    expect(profile.totalMonths).toBe(0);
    expect(profile.earliest).toBeNull();
  });
});

describe('classifyRequirements', () => {
  it('separates must-have and differential sections', () => {
    const text = `About the role
You will build production Ruby APIs for our platform every day.
Requirements
Five or more years working with Ruby on Rails in production systems.
Nice to have
Experience with Terraform and Kubernetes in cloud environments.`;
    const result = classifyRequirements(text);
    expect(result.mustHave.join(' ')).toMatch(/Rails/);
    expect(result.differentials.join(' ')).toMatch(/Terraform/);
  });
});

describe('calculateFitHybrid', () => {
  it('scores a matching CV higher than an unrelated one', () => {
    const matching = calculateFitHybrid({
      cvEN: CV_WITH_DATES,
      cvPT: CV_WITH_DATES,
      jobText: JOB,
    });
    const unrelated = calculateFitHybrid({
      cvEN: 'Pastry chef with ten years of experience in French cuisine.',
      cvPT: 'Confeiteiro com dez anos de experiência.',
      jobText: JOB,
    });

    expect(matching.language).toBe('en');
    expect(matching.fitPercentage).toBeGreaterThan(unrelated.fitPercentage);
    expect(matching.breakdown.temporal).toBeGreaterThan(0);
  });

  it('requires the CV in the posting language', () => {
    expect(() =>
      calculateFitHybrid({
        cvEN: '',
        cvPT: '',
        jobText: 'Requirements: experience with Ruby.',
      }),
    ).toThrow(/obrigatório/);
  });
});
