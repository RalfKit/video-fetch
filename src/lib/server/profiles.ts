import type { ArgsOptions } from 'ytdlp-nodejs';
import { db } from './db/index';
import { downloadProfiles, type DownloadProfile } from './db/schema';

export type ProfileOptions = Pick<
	ArgsOptions,
	| 'format'
	| 'formatSort'
	| 'mergeOutputFormat'
	| 'extractAudio'
	| 'audioFormat'
	| 'audioQuality'
	| 'embedMetadata'
	| 'writeInfoJson'
	| 'writeThumbnail'
	| 'retries'
	| 'limitRate'
	| 'additionalOptions'
	| 'postprocessorArgs'
	| 'extractorArgs'
>;

export const BUILTIN_PROFILES: Array<
	DownloadProfile & {
		options: ProfileOptions;
	}
> = [
	{
		id: 'best',
		name: 'Best Quality',
		description: 'Best available video and audio.',
		optionsJson: '{}',
		options: {
			format: 'bv*+ba/b',
			mergeOutputFormat: 'mp4',
			embedMetadata: true
		},
		isDefault: true,
		createdAt: new Date()
	},
	{
		id: '1080p_mp4',
		name: '1080p MP4',
		description: 'Best MP4 up to 1080p.',
		optionsJson: '{}',
		options: {
			format: 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b',
			mergeOutputFormat: 'mp4',
			embedMetadata: true
		},
		isDefault: false,
		createdAt: new Date()
	},
	{
		id: 'audio_only',
		name: 'Audio Only',
		description: 'Extract audio as MP3.',
		optionsJson: '{}',
		options: {
			format: 'ba/b',
			extractAudio: true,
			audioFormat: 'mp3',
			audioQuality: '0',
			embedMetadata: true
		},
		isDefault: false,
		createdAt: new Date()
	},
	{
		id: 'archive',
		name: 'Archive Mode',
		description: 'Keep metadata and thumbnail sidecars.',
		optionsJson: '{}',
		options: {
			format: 'bv*+ba/b',
			mergeOutputFormat: 'mkv',
			writeInfoJson: true,
			writeThumbnail: true,
			embedMetadata: true
		},
		isDefault: false,
		createdAt: new Date()
	},
	{
		id: 'mobile',
		name: 'Mobile Friendly',
		description: 'Smaller MP4 capped at 720p.',
		optionsJson: '{}',
		options: {
			format: 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b',
			mergeOutputFormat: 'mp4',
			embedMetadata: true
		},
		isDefault: false,
		createdAt: new Date()
	}
].map((profile) => ({ ...profile, optionsJson: JSON.stringify(profile.options) }));

export function getBuiltinProfile(id?: string | null) {
	return BUILTIN_PROFILES.find((profile) => profile.id === id) ?? BUILTIN_PROFILES[0];
}

export async function listProfiles() {
	const custom = await db.select().from(downloadProfiles);
	return [...BUILTIN_PROFILES, ...custom];
}

export function parseProfileOptions(profile: Pick<DownloadProfile, 'optionsJson'>): ProfileOptions {
	try {
		return JSON.parse(profile.optionsJson) as ProfileOptions;
	} catch {
		return {};
	}
}
