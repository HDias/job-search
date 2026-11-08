import type { Profile } from '../domain/profile.js';
import type { Store } from '../repositories/types.js';

/**
 * Resolves a base resume the same way v1 did (exact stack+language, same stack
 * alternate language, ruby fallback), but from the DB and only enabled targets
 * (D5). Returns `null` when no enabled profile is available.
 */

export interface ResolvedProfile {
  profile: Profile;
  stack: string;
  language: 'pt-br' | 'en';
  rawText: string;
}

export function profileRawText(profile: Profile | null): string {
  const content = profile?.content;
  if (!content || typeof content !== 'object') return '';
  const rawText = (content as { rawText?: unknown }).rawText;
  return typeof rawText === 'string' ? rawText : '';
}

function enabled(profile: Profile | null): Profile | null {
  return profile && profile.enabled ? profile : null;
}

export function resolveProfileWithFallback(
  store: Store,
  stack: string,
  language: string,
): ResolvedProfile | null {
  const baseStack = String(stack || 'ruby').toLowerCase() === 'php' ? 'php' : 'ruby';
  const langKey = language === 'en' ? 'en' : 'pt-br';
  const fallbackLang = langKey === 'en' ? 'pt-br' : 'en';

  const candidates: [string, 'pt-br' | 'en'][] = [
    [baseStack, langKey],
    [baseStack, fallbackLang],
  ];
  if (baseStack !== 'ruby') {
    candidates.push(['ruby', langKey], ['ruby', fallbackLang]);
  }

  for (const [candidateStack, candidateLanguage] of candidates) {
    const profile = enabled(
      store.profiles.get(candidateStack, candidateLanguage),
    );
    if (!profile) continue;
    return {
      profile,
      stack: candidateStack,
      language: candidateLanguage,
      rawText: profileRawText(profile),
    };
  }

  return null;
}

/** Both language variants for the deterministic engine (PT and EN). */
export function resolveLanguagePair(
  store: Store,
  stack: string,
): { cvPT: string; cvEN: string; profile: Profile | null } {
  const baseStack = String(stack || 'ruby').toLowerCase() === 'php' ? 'php' : 'ruby';
  const pt = enabled(store.profiles.get(baseStack, 'pt-br'));
  const en = enabled(store.profiles.get(baseStack, 'en'));
  return {
    cvPT: profileRawText(pt),
    cvEN: profileRawText(en),
    profile: pt ?? en,
  };
}
