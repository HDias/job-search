export interface Profile {
  stack: string;
  language: string;
  content: unknown;
  updatedAt: string;
}

export interface SettingsEntry {
  key: string;
  value: unknown;
  updatedAt: string;
}
