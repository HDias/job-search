/** Files the user can choose when generating a kit (all selected by default). */
export const KIT_FILE_OPTIONS = [
  { kind: 'cv_pdf', label: 'Currículo (PDF)' },
  { kind: 'cv_html', label: 'Currículo (HTML)' },
  { kind: 'cover_letter_pdf', label: 'Cover letter (PDF)' },
  { kind: 'cover_letter_html', label: 'Cover letter (HTML)' },
  { kind: 'email_text', label: 'E-mail de candidatura' },
  { kind: 'recruiter_note', label: 'Mensagem ao recrutador' },
  { kind: 'linkedin_note', label: 'Mensagem LinkedIn' },
  { kind: 'job_posting', label: 'Texto da vaga' },
] as const;
