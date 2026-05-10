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
