import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Patches larger than this are refused. A full-tree Prettier pass is far smaller. */
export const MAX_PATCH_BYTES = 500_000;

/** More files than Prettier can see in this repo is not a formatting fix. */
export const MAX_PATCH_FILES = 100;

const ALLOWED_EXTENSIONS = new Set([
	'.ts',
	'.js',
	'.mjs',
	'.cjs',
	'.svelte',
	'.css',
	'.html',
	'.json',
	'.md',
	'.yml',
	'.yaml'
]);

/** Prettier formats these extension-less files. */
const ALLOWED_BASENAMES = new Set(['.prettierrc']);

/**
 * Lockfiles are Prettier-ignored. A patch that touches them is not a format fix.
 * Workflow files are formatted by Prettier, but accepting them would let a
 * compromised formatter rewrite CI and the next same-repo pull_request run
 * would execute that workflow. Those diffs fail closed for a human to review.
 */
const DENY_BASENAMES = new Set([
	'pnpm-lock.yaml',
	'package-lock.json',
	'yarn.lock',
	'bun.lock',
	'bun.lockb',
	'Dockerfile',
	'.dockerignore'
]);

/**
 * Validate a `git diff` produced by Prettier before it is applied on a
 * Dependabot branch. Throws when the patch is empty, too large, or touches a
 * path the push job must not change. Returns the accepted paths.
 *
 * @param {string} patchText
 * @returns {string[]}
 */
export function validateFormatPatch(patchText) {
	if (typeof patchText !== 'string' || patchText.length === 0) {
		throw new Error('Format patch is empty.');
	}
	if (patchText.includes('\0')) {
		throw new Error('Format patch contains a NUL byte.');
	}
	if (Buffer.byteLength(patchText) > MAX_PATCH_BYTES) {
		throw new Error(`Format patch exceeds ${MAX_PATCH_BYTES} bytes.`);
	}

	const lines = patchText.split(/\r?\n/);
	/** @type {string[]} */
	const paths = [];
	/** @type {string | null} */
	let current = null;

	for (const line of lines) {
		if (line.startsWith('diff --git ')) {
			const match = /^diff --git a\/(\S+) b\/(\S+)$/.exec(line);
			if (!match || match[1] !== match[2]) {
				throw new Error(`Refusing unparsed or renamed diff header: ${line}`);
			}
			assertSafePath(match[1]);
			paths.push(match[1]);
			current = match[1];
			continue;
		}

		if (
			line.startsWith('rename from ') ||
			line.startsWith('rename to ') ||
			line.startsWith('copy from ') ||
			line.startsWith('copy to ') ||
			line.startsWith('new file mode ') ||
			line.startsWith('deleted file mode ') ||
			line.startsWith('old mode ') ||
			line.startsWith('new mode ') ||
			line.startsWith('Binary files ') ||
			line.startsWith('GIT binary patch') ||
			line === '--- /dev/null' ||
			line === '+++ /dev/null'
		) {
			throw new Error(`Refusing non-formatting diff line: ${line}`);
		}

		const indexMode = /^index [0-9a-f]+\.\.[0-9a-f]+ ([0-7]{6})$/.exec(line);
		if (indexMode && indexMode[1] !== '100644') {
			throw new Error(`Refusing file mode ${indexMode[1]}.`);
		}

		if (line.startsWith('--- ')) {
			if (!current || line !== `--- a/${current}`) {
				throw new Error(`Diff minus path does not match the header: ${line}`);
			}
		}
		if (line.startsWith('+++ ')) {
			if (!current || line !== `+++ b/${current}`) {
				throw new Error(`Diff plus path does not match the header: ${line}`);
			}
		}
	}

	if (paths.length === 0) {
		throw new Error('Format patch does not contain a diff.');
	}
	if (paths.length > MAX_PATCH_FILES) {
		throw new Error(`Format patch touches ${paths.length} files (limit ${MAX_PATCH_FILES}).`);
	}

	return paths;
}

/**
 * @param {string} filePath
 */
function assertSafePath(filePath) {
	if (
		filePath.startsWith('/') ||
		filePath.includes('\\') ||
		filePath.includes(':') ||
		filePath.split('/').includes('..') ||
		filePath.split('/').includes('.')
	) {
		throw new Error(`Unsafe path in format patch: ${filePath}`);
	}

	const parts = filePath.split('/');
	if (parts[0] === '.github' || parts[0] === '.git' || parts[0] === 'node_modules') {
		throw new Error(`Refusing to apply a format patch to ${filePath}.`);
	}

	const base = parts[parts.length - 1];
	if (DENY_BASENAMES.has(base)) {
		throw new Error(`Refusing to apply a format patch to ${filePath}.`);
	}
	if (ALLOWED_BASENAMES.has(base)) {
		return;
	}

	const dot = base.lastIndexOf('.');
	const extension = dot >= 0 ? base.slice(dot) : '';
	if (!ALLOWED_EXTENSIONS.has(extension)) {
		throw new Error(`Refusing to apply a format patch to ${filePath} (unsupported file type).`);
	}
}

function main() {
	const file = process.argv[2];
	if (!file) {
		console.error('usage: validate-format-patch.mjs <patch-file>');
		process.exit(2);
	}

	try {
		const paths = validateFormatPatch(readFileSync(file, 'utf8'));
		console.log(`Accepted ${paths.length} formatted file(s):`);
		for (const filePath of paths) {
			console.log(`  ${filePath}`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	}
}

const invokedDirectly =
	process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
	main();
}
