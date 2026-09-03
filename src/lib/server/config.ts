import path from 'path';
import fs from 'fs';
import { env as private_env } from '$env/dynamic/private';

// Pfad entweder aus ENV oder Default './downloads'
export const DOWNLOAD_FOLDER = private_env.DOWNLOAD_PATH
	? path.resolve(private_env.DOWNLOAD_PATH)
	: path.resolve('./downloads');

export const TEMP_DOWNLOAD_FOLDER = private_env.TEMP_DOWNLOAD_PATH
	? path.resolve(private_env.TEMP_DOWNLOAD_PATH)
	: path.resolve(DOWNLOAD_FOLDER, '.incomplete');

/**
 * Ob beim Löschen eines abgeschlossenen Downloads auch die zugehörige Datei
 * entfernt werden soll. Standard: false (nur der Datenbankeintrag wird gelöscht).
 * Aktivierung über `DELETE_FILE_ON_DELETE=true`.
 */
export const DELETE_FILE_ON_DELETE = /^(1|true|yes|on)$/i.test(
	(private_env.DELETE_FILE_ON_DELETE ?? '').trim()
);

/**
 * Ob Thumbnails verwendet werden sollen. Standard: aktiviert.
 * Deaktivierung über `ENABLE_THUMBNAILS=false` (bzw. 0/no/off).
 *
 * Bei Deaktivierung werden keine Thumbnail-URLs gespeichert und yt-dlp lädt
 * keine Thumbnail-Dateien herunter (writeThumbnail wird erzwungen abgeschaltet).
 */
export const ENABLE_THUMBNAILS = !/^(0|false|no|off)$/i.test(
	(private_env.ENABLE_THUMBNAILS ?? '').trim()
);

// Stelle sicher, dass der Ordner existiert
if (!fs.existsSync(DOWNLOAD_FOLDER)) {
	fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
	console.log(`Download folder created: ${DOWNLOAD_FOLDER}`);
} else {
	console.log(`Download folder exists: ${DOWNLOAD_FOLDER}`);
}

if (!fs.existsSync(TEMP_DOWNLOAD_FOLDER)) {
	fs.mkdirSync(TEMP_DOWNLOAD_FOLDER, { recursive: true });
	console.log(`Temporary download folder created: ${TEMP_DOWNLOAD_FOLDER}`);
} else {
	console.log(`Temporary download folder exists: ${TEMP_DOWNLOAD_FOLDER}`);
}
