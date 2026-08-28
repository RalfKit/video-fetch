import path from 'path';

// Ungültige Dateiname-Zeichen für Windows: \ / : * ? " < > |
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

// Steuerzeichen: 0–31 + 128–159
const CONTROL_CHARS = /\p{C}/gu; // Alle Unicode Control Characters

// Mehrfache Leerzeichen normalisieren
const MULTI_SPACE = /\s+/g;

export function sanitizeFilename(input: string): string {
	const cleaned = input
		.replace(INVALID_FILENAME_CHARS, '-') // Verbotene Zeichen ersetzen
		.replace(CONTROL_CHARS, '') // Steuerzeichen entfernen
		.replace(MULTI_SPACE, ' ') // Spaces normalisieren
		.replace(/[. ]+$/, '') // Punkte/Spaces am Ende entfernen
		.trim();

	return cleaned || 'video';
}

/**
 * Resolves `relativePath` against `root` and guarantees the result stays inside
 * `root`. Protects against path traversal (`..`) and absolute-path injection.
 * Throws if the resolved path would escape `root`.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
	const resolvedRoot = path.resolve(root);
	const absolute = path.resolve(resolvedRoot, relativePath);

	if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
		throw new Error('Resolved path escapes the allowed root directory');
	}

	return absolute;
}

export function splitShellLikeArgs(input: string): string[] {
	const result: string[] = [];
	let current = '';
	let quote: '"' | "'" | null = null;
	let escaping = false;

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === '\\') {
			escaping = true;
			continue;
		}
		if ((char === '"' || char === "'") && (!quote || quote === char)) {
			quote = quote ? null : char;
			continue;
		}
		if (!quote && /\s/.test(char)) {
			if (current) result.push(current);
			current = '';
			continue;
		}
		current += char;
	}

	if (current) result.push(current);
	return result;
}
