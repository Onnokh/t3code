import { useCallback } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";

/**
 * The persisted SEO Site selection. The choice is device-local (mobile
 * preferences), applies to every SEO screen, and survives app restart per
 * the SEO Read Contract. The SEO home screen resolves and persists the
 * first-install default visibly; every other screen only reads it.
 */
export function useSeoSitePreference(): {
  readonly selectedSiteId: string | null;
  readonly ready: boolean;
  readonly select: (siteId: string) => void;
} {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const ready = AsyncResult.isSuccess(preferencesResult);
  const selectedSiteId = ready ? (preferencesResult.value.seoSelectedSite ?? null) : null;

  const select = useCallback(
    (siteId: string) => {
      savePreferences({ seoSelectedSite: siteId });
    },
    [savePreferences],
  );

  return { selectedSiteId, ready, select };
}
