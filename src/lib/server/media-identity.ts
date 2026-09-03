/**
 * Media identity helpers for duplicate detection.
 *
 * yt-dlp's `generic` extractor derives the media `id` from the URL itself
 * (the basename or query fragments of signed CDN / M3U8 links). That value is
 * NOT a stable, global media identity: two completely unrelated videos can end
 * up with the same derived id. Real, observed collisions include:
 *
 *   - `zo=&i=185`                      (query fragment of a CDN URL)
 *   - `index-v1-a1.m3u8?...&i=185`     (M3U8 playlist URL fragment)
 *
 * Treating `extractor + id` as a unique identity is therefore only valid for
 * real site extractors (youtube, vimeo, …), never for `generic`. For generic /
 * direct / M3U8 sources we must not derive a global identity from a random URL
 * fragment; otherwise different videos are falsely detected as duplicates and
 * cancelled with "Already downloaded or queued".
 *
 * Exact same-URL re-adds are still prevented independently by the unique
 * `video_url` index, so being conservative here only risks an occasional real
 * re-download (safe) instead of wrongly cancelling a different video (unsafe).
 */

/** Extractors whose `id` is not a stable, global media identity. */
const UNRELIABLE_EXTRACTORS = new Set(['generic']);

/**
 * Whether `extractor + videoId` can be trusted as a stable, globally unique
 * media identity suitable for duplicate detection.
 */
export function isReliableMediaIdentity(
	extractor?: string | null,
	videoId?: string | null
): boolean {
	const normalizedExtractor = (extractor ?? '').trim().toLowerCase();
	const normalizedId = (videoId ?? '').trim();

	if (!normalizedExtractor || !normalizedId) return false;

	return !UNRELIABLE_EXTRACTORS.has(normalizedExtractor);
}

/**
 * Returns the `videoId` only when `extractor + videoId` form a reliable, stable
 * media identity; otherwise `null`.
 *
 * Persist and compare identity using this value so an unreliable generic id is
 * never stored in `extractor_video_id` nor used for duplicate detection.
 */
export function reliableExtractorVideoId(
	extractor?: string | null,
	videoId?: string | null
): string | null {
	return isReliableMediaIdentity(extractor, videoId) ? (videoId as string) : null;
}
