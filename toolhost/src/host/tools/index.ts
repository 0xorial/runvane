import type { TargetTool } from '../server.ts';
import { curlTool } from './curl.ts';
import { execTool } from './exec.ts';
import { filesystemTool } from './fs.ts';
import { filesystemReadTool } from './fs-read.ts';
import { filesystemWriteTool } from './fs-write.ts';

export { curlTool } from './curl.ts';
export { execTool } from './exec.ts';
export { filesystemTool } from './fs.ts';
export { filesystemReadTool } from './fs-read.ts';
export { filesystemWriteTool } from './fs-write.ts';

/** The target tools a default host serves. */
export function defaultTargetTools(): TargetTool[] {
  return [curlTool, execTool, filesystemTool, filesystemReadTool, filesystemWriteTool];
}
