import { describe, expect, it } from 'vitest';
import { MAX_PATCH_BYTES, MAX_PATCH_FILES, validateFormatPatch } from './validate-format-patch.mjs';

function diff(filePath: string, body = '+formatted\n'): string {
	return [
		`diff --git a/${filePath} b/${filePath}`,
		'index 1111111..2222222 100644',
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
		'@@ -1 +1 @@',
		'-before',
		body.trimEnd(),
		''
	].join('\n');
}

describe('validateFormatPatch', () => {
	it('accepts a source formatting diff', () => {
		expect(validateFormatPatch(diff('src/lib/types/download.ts'))).toEqual([
			'src/lib/types/download.ts'
		]);
	});

	it('accepts package.json, markdown, and .prettierrc', () => {
		const patch = [diff('package.json'), diff('.prettierrc'), diff('README.md')].join('');
		expect(validateFormatPatch(patch)).toEqual(['package.json', '.prettierrc', 'README.md']);
	});

	it('accepts bracketed SvelteKit routes', () => {
		expect(validateFormatPatch(diff('src/routes/api/media/[id]/+server.ts'))).toEqual([
			'src/routes/api/media/[id]/+server.ts'
		]);
	});

	it('rejects workflow and dependabot config changes', () => {
		expect(() => validateFormatPatch(diff('.github/workflows/ci.yml'))).toThrow(/Refusing/);
		expect(() => validateFormatPatch(diff('.github/dependabot.yml'))).toThrow(/Refusing/);
	});

	it('rejects a source fix mixed with a workflow change', () => {
		const patch = diff('src/lib/types/download.ts') + diff('.github/workflows/ci.yml');
		expect(() => validateFormatPatch(patch)).toThrow(/\.github\/workflows\/ci\.yml/);
	});

	it('rejects lockfiles, Dockerfiles, and unknown types', () => {
		expect(() => validateFormatPatch(diff('pnpm-lock.yaml'))).toThrow(/Refusing/);
		expect(() => validateFormatPatch(diff('Dockerfile'))).toThrow(/Refusing/);
		expect(() => validateFormatPatch(diff('scripts/exploit.sh'))).toThrow(/unsupported file type/);
	});

	it('rejects path traversal, absolute paths, and renames', () => {
		expect(() => validateFormatPatch(diff('src/../../.github/workflows/ci.yml'))).toThrow(/Unsafe/);
		expect(() => validateFormatPatch(diff('/etc/passwd'))).toThrow(/Unsafe/);
		expect(() =>
			validateFormatPatch(
				'diff --git a/src/old.ts b/src/new.ts\n--- a/src/old.ts\n+++ b/src/new.ts\n'
			)
		).toThrow(/renamed/);
	});

	it('rejects file creation, deletion, symlinks, and binary patches', () => {
		expect(() =>
			validateFormatPatch(`${diff('src/new.ts').replace('index ', 'new file mode 100644\nindex ')}`)
		).toThrow(/non-formatting/);
		expect(() =>
			validateFormatPatch(diff('src/lib/types/download.ts').replace('100644', '120000'))
		).toThrow(/file mode 120000/);
		expect(() =>
			validateFormatPatch('diff --git a/src/a.ts b/src/a.ts\nGIT binary patch\n')
		).toThrow(/non-formatting/);
	});

	it('rejects a minus path that disagrees with the header', () => {
		const patch = diff('src/lib/types/download.ts').replace(
			'--- a/src/lib/types/download.ts',
			'--- a/.github/workflows/ci.yml'
		);
		expect(() => validateFormatPatch(patch)).toThrow(/minus path/);
	});

	it('rejects empty, NUL, oversized, and huge patches', () => {
		expect(() => validateFormatPatch('')).toThrow(/empty/);
		expect(() => validateFormatPatch(`\0${diff('src/a.ts')}`)).toThrow(/NUL/);
		expect(() => validateFormatPatch(`${'x'.repeat(MAX_PATCH_BYTES + 1)}`)).toThrow(/exceeds/);

		const many = Array.from({ length: MAX_PATCH_FILES + 1 }, (_, index) =>
			diff(`src/file-${index}.ts`)
		).join('');
		expect(() => validateFormatPatch(many)).toThrow(/limit/);
	});
});
