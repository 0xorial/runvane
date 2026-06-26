import type { TargetTool } from '../server.ts';
import { execTool } from './exec.ts';
import { filesystemTool } from './fs.ts';

export { execTool } from './exec.ts';
export { filesystemTool } from './fs.ts';

/** The target tools a default host serves. */
export function defaultTargetTools(): TargetTool[] {
  return [execTool, filesystemTool];
}
