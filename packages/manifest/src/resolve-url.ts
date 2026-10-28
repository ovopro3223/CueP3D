/**
 * Resolves a manifest-relative URL (tier/proxy `url` fields) against the
 * manifest's own absolute URL, per docs/01-design.md §5.2: "All URLs are
 * relative to the manifest's own URL."
 */
export function resolveUrl(manifestUrl: string, relative: string): string {
  return new URL(relative, manifestUrl).toString();
}
