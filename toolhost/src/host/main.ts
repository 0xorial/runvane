import process from 'node:process';
import type { BrainToHost, HostToBrain } from '../protocol/messages.ts';
import { streamChannel } from '../transport/ndjson.ts';
import { ToolHostServer } from './server.ts';
import { defaultRuntimeTools } from './tools/index.ts';

/**
 * Standalone tool-host entrypoint: speak the protocol as NDJSON over stdio.
 * This is exactly what a local child transport and ssh spawn. Logs go to
 * stderr — stdout carries only protocol messages.
 */
const channel = streamChannel<BrainToHost, HostToBrain>(process.stdin, process.stdout);
const server = new ToolHostServer(channel, defaultRuntimeTools());
server.start();
