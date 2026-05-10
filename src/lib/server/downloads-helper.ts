import type { AdvancedOptions, DownloadSource } from '$lib/types/download';
import type { DownloadAdd } from '$lib/server/db/schema';
import { sanitizeFilename, splitShellLikeArgs } from '$lib/server/utils';
import { getBuiltinProfile } from './profiles';
import { ensureExistingDownloadFolder, sanitizeFolder } from './folders';

const URL_PATTERN = /^(https?:\/\/).+$/i;
const MAX_FILENAME_LENGTH = 200;

export type IncomingDownload = {
	videoUrl: string;
	fileName?: string | null;
	appendTitle?: boolean;
	quality?: string;
	profileId?: string | null;
	folder?: string | null;
	source?: DownloadSource;
	subscriptionId?: string | null;
	advanced?: AdvancedOptions | null;
	customArgs?: string | null;
};

export class ValidationError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export async function prepareDownloadItems(
	input: IncomingDownload | IncomingDownload[],
	defaultSource: DownloadSource = 'manual'
): Promise<DownloadAdd[]> {
	const rawItems = Array.isArray(input) ? input : [input];
	if (rawItems.length === 0) throw new ValidationError(400, 'No download data provided');

	const result: DownloadAdd[] = [];

	for (const [index, raw] of rawItems.entries()) {
		const videoUrl = (raw.videoUrl || '').toString().trim();
		if (!videoUrl) throw new ValidationError(400, `Empty URL in entry ${index + 1}`);
		if (!URL_PATTERN.test(videoUrl)) {
			throw new ValidationError(400, `Invalid URL in entry ${index + 1}: ${videoUrl}`);
		}

		const fileName = raw.fileName ? sanitizeFilename(String(raw.fileName).trim()) : null;
		if (fileName && fileName.length > MAX_FILENAME_LENGTH) {
			throw new ValidationError(
				400,
				`Filename too long (max. ${MAX_FILENAME_LENGTH} characters): ${fileName}`
			);
		}

		const folder = sanitizeFolder(raw.folder);
		await ensureExistingDownloadFolder(folder);

		const advanced = normalizeAdvanced(raw);
		const profileId = raw.profileId || getBuiltinProfile(raw.quality).id;

		result.push({
			videoUrl,
			originalUrl: videoUrl,
			fileName,
			appendTitle: !!raw.appendTitle,
			quality: (raw.quality as DownloadAdd['quality']) ?? 'best',
			profileId,
			folder,
			source: raw.source ?? defaultSource,
			subscriptionId: raw.subscriptionId ?? null,
			advancedOptionsJson: advanced ? JSON.stringify(advanced) : null,
			status: 'pending'
		});
	}

	return result;
}

function normalizeAdvanced(raw: IncomingDownload): AdvancedOptions | null {
	const advanced = raw.advanced ? { ...raw.advanced } : {};
	if (raw.customArgs) advanced.customArgs = splitShellLikeArgs(raw.customArgs);

	if (advanced.retries !== undefined) {
		const retries = Number(advanced.retries);
		advanced.retries = Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : undefined;
	}

	if (advanced.rateLimit !== undefined && advanced.rateLimit !== null) {
		advanced.rateLimit = String(advanced.rateLimit).trim() || null;
	}

	return Object.keys(advanced).length ? advanced : null;
}
