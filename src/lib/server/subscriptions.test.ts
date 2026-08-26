import { describe, it, expect } from 'vitest';
import { validateSubscriptionFilterRules } from './subscriptions';

describe('subscription import/filter pipeline', () => {
	it('applies onboarding modes and content filters correctly', () => {
		const result = validateSubscriptionFilterRules();

		// "new_only" must not queue any historical entry.
		expect(result.noInitial).toBe(true);
		// "last_videos" with limit 2 keeps the two newest entries.
		expect(result.lastTwoVideos).toBe(true);
		// "last_days" with 3 days keeps only recent entries.
		expect(result.lastThreeDays).toBe(true);
		// excludeShorts removes short entries.
		expect(result.noShorts).toBe(true);
		// Combining excludeShorts + last_days keeps only the matching entry.
		expect(result.combined).toBe(true);
	});
});
