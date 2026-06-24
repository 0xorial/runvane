import type { RuntimeTool } from '../server.ts';
import { execTool } from './exec.ts';
import { filesystemTool } from './fs.ts';

export { execTool } from './exec.ts';
export { filesystemTool } from './fs.ts';

/** The runtime tools a default host serves. */
export function defaultRuntimeTools(): RuntimeTool[] {
  return [execTool, filesystemTool];
}
