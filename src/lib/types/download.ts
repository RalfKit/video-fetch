import type { Download } from '$lib/server/db/schema';
import type { VideoProgress } from 'ytdlp-nodejs';

export type DownloadStatus =
	| 'pending'
	| 'metadata_fetching'
	| 'queued'
	| 'downloading'
	| 'completed'
	| 'failed'
	| 'cancelled';

export interface DownloadItem extends Download {
	progress: VideoProgress | null;
}

export interface DownloadUpdate {
	id: string;
	videoUrl: string;
	fileName: string | null;
	status: DownloadStatus;
	errorMessage: string | null;
	progress: VideoProgress | null;
	title?: string | null;
	thumbnailUrl?: string | null;
	filePath?: string | null;
	folder?: string | null;
	createdAt?: Date;
	finishedAt?: Date | null;
}

export type DownloadQuality =
	| 'highest'
	| 'lowest'
	| 'best'
	| '1080p_mp4'
	| 'audio_only'
	| 'archive'
	| 'mobile';

export type DownloadSource = 'manual' | 'api' | 'subscription' | 'extension';

export type AdvancedOptions = {
	customArgs?: string[];
	embedSubtitles?: boolean;
	retries?: number;
	postprocessors?: string[];
	rateLimit?: string | null;
	extractorArgs?: Record<string, string[]>;
};

export type YtDlpFormat = {
	format?: string;
	sort?: string;
};
