import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { TargetTool } from '../server.ts';
import { resolveWritablePath, unifiedDiff } from './fs.ts';
import {
  applyRangeEdit,
  asObject,
  countOccurrences,
  fileHash,
  optNonNegInt,
  optPositiveInt,
  requireString,
  WRITE_GOVERNANCE_KEYS,
  writeGovernance,
  type WriteGovernance,
} from './fs-shared.ts';

/**
 * filesystem_write — the mutating half of file access. Split from reads so it
 * can stay gated (fail-closed on writable_roots, delete/move behind a rule)
 * while reads run freely.
 *
 * Anti-clobber by design: every mutation of EXISTING content (write-overwrite,
 * replace, edit) requires `file_hash` from filesystem_read; the current file is
 * re-hashed here and the call is rejected if it drifted, so parallel edits
 * can't silently overwrite each other. `edit` is a line-range replace (the
 * sed-style positional edit); `replace` is content/regex substitution.
 *
 * Governance (`writable_roots`, `max_write_bytes`, `timeout_ms`) arrives as
 * reserved params injected by the harness rules profile; containment is
 * enforced here with realpath checks (reused from the original tool).
 */

const OPERATIONS = ['write', 'replace', 'edit', 'mkdir', 'move', 'delete'] as const;
type WriteOperation = (typeof OPERATIONS)[number];
const TOOL = 'filesystem_write';

function checkWriteSize(content: string, gov: WriteGovernance): void {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > gov.maxWriteBytes) {
    throw new Error(
      `${TOOL}: result is ${bytes} bytes, exceeds max_write_bytes (${gov.maxWriteBytes}) — ` +
        `retry with quota_override.max_write_bytes set higher to request more (needs user approval)`,
    );
  }
}

/** Read the current file and assert its hash matches what the caller read
 *  earlier. The single guard behind edit/replace and overwrite-write. */
async function assertHash(targetPath: string, provided: unknown, op: string): Promise<string> {
  if (typeof provided !== 'string' || provided === '') {
    throw new Error(`${TOOL}: ${op} requires \`file_hash\` (from filesystem_read read/stat) to guard against clobbering a parallel change`);
  }
  const buf = await fs.readFile(targetPath).catch(() => null);
  if (buf === null) throw new Error(`${TOOL}: ${op} requires an existing file, got ${targetPath}`);
  const current = fileHash(buf);
  if (current !== provided) {
    throw new Error(
      `${TOOL}: ${op} rejected — file changed since read (you passed ${provided}, current is ${current}). ` +
        `Re-read the file with filesystem_read to get a fresh file_hash.`,
    );
  }
  return buf.toString('utf8');
}

async function writeOp(targetPath: string, o: Record<string, unknown>, gov: WriteGovernance) {
  if (typeof o.content !== 'string') throw new Error(`${TOOL}: write requires \`content\``);
  checkWriteSize(o.content, gov);
  const existed = await fs.stat(targetPath).then((s) => s.isFile(), () => false);
  if (existed) {
    // Overwriting existing content is a clobber unless the caller proves it
    // read the current version first.
    await assertHash(targetPath, o.file_hash, 'write (overwrite)');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, o.content, 'utf8');
  return {
    operation: 'write',
    path: targetPath,
    created: !existed,
    bytesWritten: Buffer.byteLength(o.content, 'utf8'),
    hash: fileHash(Buffer.from(o.content, 'utf8')),
  };
}

async function replaceOp(targetPath: string, o: Record<string, unknown>, gov: WriteGovernance) {
  const before = await assertHash(targetPath, o.file_hash, 'replace');
  const oldString = requireString(o, 'old_string', TOOL);
  const newString = typeof o.new_string === 'string' ? o.new_string : '';
  const replaceAll = o.replace_all === true;

  let after: string;
  let replacements: number;
  if (o.is_regex === true) {
    let re: RegExp;
    try {
      re = new RegExp(oldString, replaceAll ? 'g' : '');
    } catch (err) {
      throw new Error(`${TOOL}: invalid regex — ${err instanceof Error ? err.message : String(err)}`);
    }
    replacements = (before.match(new RegExp(oldString, 'g')) ?? []).length;
    if (replacements === 0) throw new Error(`${TOOL}: replace pattern matched nothing`);
    // String.replace honours $1/$& backrefs in new_string natively (sed-style).
    after = before.replace(re, newString);
    if (!replaceAll) replacements = 1;
  } else {
    const occ = countOccurrences(before, oldString);
    if (occ === 0) throw new Error(`${TOOL}: replace old_string not found in file`);
    if (occ > 1 && !replaceAll) {
      throw new Error(`${TOOL}: old_string appears ${occ} times — pass replace_all: true, or include more surrounding text to make it unique`);
    }
    after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
    replacements = replaceAll ? occ : 1;
  }

  checkWriteSize(after, gov);
  await fs.writeFile(targetPath, after, 'utf8');
  return {
    operation: 'replace',
    path: targetPath,
    replacements,
    diff: unifiedDiff(before, after, path.basename(targetPath)),
    hash: fileHash(Buffer.from(after, 'utf8')),
  };
}

async function editOp(targetPath: string, o: Record<string, unknown>, gov: WriteGovernance) {
  const before = await assertHash(targetPath, o.file_hash, 'edit');
  const offset = optPositiveInt(o, 'offset', TOOL);
  if (offset === undefined) throw new Error(`${TOOL}: edit requires \`offset\` (1-based line)`);
  const length = optNonNegInt(o, 'length', TOOL) ?? 0;
  const content = typeof o.content === 'string' ? o.content : '';
  const after = applyRangeEdit(before, offset, length, content);

  checkWriteSize(after, gov);
  await fs.writeFile(targetPath, after, 'utf8');
  return {
    operation: 'edit',
    path: targetPath,
    diff: unifiedDiff(before, after, path.basename(targetPath)),
    hash: fileHash(Buffer.from(after, 'utf8')),
  };
}

async function mkdirOp(targetPath: string) {
  await fs.mkdir(targetPath, { recursive: true });
  return { operation: 'mkdir', path: targetPath, created: true };
}

async function moveOp(targetPath: string, o: Record<string, unknown>, gov: WriteGovernance) {
  const to = requireString(o, 'to', TOOL);
  const dest = await resolveWritablePath(to, gov.writableRoots);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(targetPath, dest);
  return { operation: 'move', from: targetPath, to: dest };
}

async function deleteOp(targetPath: string) {
  const st = await fs.stat(targetPath).catch(() => null);
  if (!st) throw new Error(`${TOOL}: delete target does not exist: ${targetPath}`);
  if (st.isDirectory()) throw new Error(`${TOOL}: delete refuses a directory (${targetPath}); remove files individually`);
  await fs.unlink(targetPath);
  return { operation: 'delete', path: targetPath, deleted: true };
}

export const filesystemWriteTool: TargetTool = {
  name: 'filesystem_write',
  aiDescription:
    "Create and modify files where this conversation's sandbox lives: write a whole file, replace text (literal or regex, sed-style), " +
    'insert/replace a line range (edit), or mkdir/move/delete. Confined to writable roots; disabled unless one is configured. ' +
    'write-overwrite, replace, and edit require `file_hash` from filesystem_read to guard against clobbering a parallel change.',
  humanDescription: 'Create, edit, move, and delete files in the sandbox.',
  paramsSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: [...OPERATIONS],
        description:
          'write: whole file (creates parents; file_hash required to overwrite). replace: swap old_string→new_string, literal or regex, requires file_hash. ' +
          'edit: replace `length` lines from `offset` with `content` (length 0 inserts, empty content deletes), requires file_hash. ' +
          'mkdir: create a directory. move: rename path→to. delete: remove a file.',
      },
      path: { type: 'string', description: 'Target path in the sandbox (for move, the source path).' },
      content: { type: 'string', description: 'File body (write) or replacement text for the line range (edit).' },
      file_hash: { type: 'string', description: 'Hash from filesystem_read (read/stat). Required for edit, replace, and overwriting write.' },
      old_string: { type: 'string', description: 'Text/pattern to replace (replace only).' },
      new_string: { type: 'string', description: 'Replacement text (replace only). Supports $1 backrefs when is_regex. Empty deletes the match.' },
      is_regex: { type: 'boolean', description: 'Treat old_string as a regular expression (replace only). Default false.' },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring a unique match (replace only). Default false.' },
      offset: { type: 'number', description: '1-based line to act at (edit only). offset = lastLine+1 appends.' },
      length: { type: 'number', description: 'Lines to replace starting at offset (edit only). 0 = pure insert. Default 0.' },
      to: { type: 'string', description: 'Destination path (move only).' },
      quota_override: {
        type: 'object',
        description: 'Request higher limits for THIS call only, e.g. {"max_write_bytes": 8000000}. Triggers a user-approval prompt.',
      },
    },
    required: ['operation', 'path'],
  },
  async run(raw, ctx) {
    const o = asObject(raw);
    const operation = requireString(o, 'operation', TOOL) as WriteOperation;
    if (!OPERATIONS.includes(operation)) {
      throw new Error(`${TOOL}: unknown operation '${operation}' (expected ${OPERATIONS.join(', ')})`);
    }
    const gov = writeGovernance(o);
    for (const key of WRITE_GOVERNANCE_KEYS) delete o[key];

    const requested = requireString(o, 'path', TOOL);
    const targetPath = await resolveWritablePath(requested, gov.writableRoots);
    ctx.log(`${operation} ${targetPath}`);

    switch (operation) {
      case 'write':
        return writeOp(targetPath, o, gov);
      case 'replace':
        return replaceOp(targetPath, o, gov);
      case 'edit':
        return editOp(targetPath, o, gov);
      case 'mkdir':
        return mkdirOp(targetPath);
      case 'move':
        return moveOp(targetPath, o, gov);
      case 'delete':
        return deleteOp(targetPath);
    }
  },
};
