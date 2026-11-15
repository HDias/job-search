import { describe, expect, it } from 'vitest';
import {
  generateSuggestions,
  renderSuggestionsMarkdown,
} from '../src/pipeline/kit/suggestions.js';

const RAW_TEXT = [
  'Horecio Dias',
  'horecio@example.com',
  '+55 63 99999-0000',
  'linkedin.com/in/horecio',
  'github.com/horecio',
  'Palmas, Tocantins, Brazil',
  'Summary',
  'Senior engineer with 10+ years building Rails products.',
  'Highlights: Rails, PostgreSQL',
  'Experience',
  'CESAR - Instituto de Inovação',
  'Senior Software Engineer',
  'January 2020 - Present',
  'Led a Rails platform and mentored juniors.',
  'Skills',
  'Ruby on Rails, Docker, PostgreSQL, Datadog, Claude Code',
  'Languages',
  'Português - Native',
  'Inglês - Professional Working',
].join('\n');

const QUESTIONS = [
  {
    id: 'q1',
    label: 'Do you have experience with Ruby on Rails?',
    type: 'textarea',
    required: true,
    category: 'custom',
  },
  {
    id: 'q2',
    label: 'Are you authorized to work in Brazil?',
    type: 'select',
    options: ['Yes', 'No'],
    required: true,
    category: 'legal',
  },
  {
    id: 'q3',
    label: 'Gender identity',
    type: 'select',
    options: ['Male', 'Female'],
    required: false,
    category: 'demographic',
  },
];

const STANDARD_FIELDS = [{ id: 'email', label: 'Email', type: 'text' }];

describe('generateSuggestions', () => {
  it('maps standard fields directly from the base profile', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });

    expect(result.fieldMappings.email).toEqual({
      value: 'horecio@example.com',
      source: 'personalInfo.email',
      confidence: 'high',
      notes: 'Direct mapping from profile',
      profileReferences: [],
    });
  });

  it('answers a custom technical question from grounded skills only', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });

    const question = result.customQuestions.find((item) => item.id === 'q1');
    expect(question?.suggestion).toEqual({
      value: 'Proficient in Ruby on Rails, Rails, Ruby.',
      source: 'experience + skills synthesis',
      confidence: 'high',
      notes: 'Composed from 3 profile sections',
      profileReferences: [
        'skills.Backend: Ruby on Rails',
        'skills.Backend: Rails',
        'skills.Backend: Ruby',
      ],
    });
  });

  it('answers a legal select from the documented location', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });

    const legal = result.legalQuestions.find((item) => item.id === 'q2');
    expect(legal?.suggestion.value).toBe('Yes');
    expect(legal?.suggestion.confidence).toBe('high');
    expect(legal?.suggestion.source).toContain('personalInfo');
  });

  it('defaults demographic questions to "Prefer not to answer"', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });

    const demographic = result.demographicQuestions[0];
    expect(demographic.suggestion).toMatchObject({
      value: 'Prefer not to answer',
      source: 'demographic_default',
      confidence: 'high',
    });
  });

  it('decomposes a compound recruiter message without inventing numbers', () => {
    const compound =
      'If interested, could you please share your location and time zone, your expected monthly all-in rate in USD, your availability, and your updated CV?';
    const result = generateSuggestions({
      questions: [
        {
          id: 'q4',
          label: compound,
          type: 'textarea',
          required: false,
          category: 'custom',
        },
      ],
      standardFields: [],
      profile: { rawText: RAW_TEXT },
      language: 'pt-br',
    });

    const suggestion = result.customQuestions[0].suggestion;
    expect(suggestion.source).toBe('compound_decomposition');
    expect(suggestion.readyToSend).toContain('Palmas, Tocantins, Brazil');
    expect(suggestion.readyToSend).toContain('UTC-3');
    expect(suggestion.readyToSend).toContain('[preencher seu valor]');
    expect(suggestion.readyToSend).not.toMatch(/USD\s*\d/);
    expect(suggestion.needsAttention?.length).toBeGreaterThan(0);
  });

  it('is synchronous and does not depend on an LLM client', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.metadata.language).toBe('en');
  });

  it('renders a markdown view of the suggestions', () => {
    const result = generateSuggestions({
      questions: QUESTIONS,
      standardFields: STANDARD_FIELDS,
      profile: { rawText: RAW_TEXT },
      language: 'en',
    });
    const markdown = renderSuggestionsMarkdown(
      result,
      { applicationUrl: 'https://example.com/jobs/42', questions: QUESTIONS },
      'en',
    );
    expect(markdown).toContain('Application Form Answer Suggestions');
    expect(markdown).toContain('Do you have experience with Ruby on Rails?');
    expect(markdown).toContain('horecio@example.com');
  });
});
