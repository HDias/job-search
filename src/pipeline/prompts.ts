import type { Profile } from '../domain/profile.js';
import type { Store } from '../repositories/types.js';
import type { SkillLoader } from './skills/loader.js';

/**
 * Configurable-target contract: the pipeline only considers enabled targets
 * and injects the user's extra text into the fit and tailor system prompts.
 * The extra text is a style/emphasis instruction, never a source of facts —
 * grounding stays in the base resume.
 */

/** Returns the profile only if it exists and is enabled; otherwise `null`. */
export function resolveTargetProfile(
  store: Store,
  stack: string,
  language: string,
): Profile | null {
  const profile = store.profiles.get(stack, language);
  if (!profile || !profile.enabled) return null;
  return profile;
}

export function withExtraPrompt(
  base: string,
  profile: Pick<Profile, 'stack' | 'language' | 'extraPrompt'> | null,
): string {
  const extra = profile?.extraPrompt?.trim();
  if (!extra) return base;
  return `${base}\n\n=== USER EXTRA INSTRUCTIONS (${profile!.stack}/${profile!.language}) ===\n${extra}`;
}

export interface TargetSystemPrompts {
  fitSystem: string;
  tailorSystem: string;
}

/**
 * Builds the system prompts for a target. `profile` may be `null` (missing or
 * disabled target): the base prompts are returned without injection.
 */
export function targetSystemPrompts(
  loader: SkillLoader,
  profile: Pick<Profile, 'stack' | 'language' | 'extraPrompt'> | null,
): TargetSystemPrompts {
  return {
    fitSystem: withExtraPrompt(loader.buildFitSystemPrompt(), profile),
    tailorSystem: withExtraPrompt(loader.buildTailorSystemPrompt(), profile),
  };
}
