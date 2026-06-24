import type { RuntimeTool } from '../server.ts';
import { execTool } from './exec.ts';
import { listDirTool, readFileTool, statTool, writeFileTool } from './fs.ts';

export { execTool } from './exec.ts';
export { listDirTool, readFileTool, statTool, writeFileTool } from './fs.ts';

/** The runtime tools a default host serves. */
export function defaultRuntimeTools(): RuntimeTool[] {
  return [execTool, readFileTool, writeFileTool, listDirTool, statTool];
}
