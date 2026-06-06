import { createTestApp, type TestApp } from './bootstrap-app';

let shared: TestApp | null = null;

export async function retainSharedTestApp(): Promise<TestApp> {
  shared ??= await createTestApp();
  return shared;
}

export async function shutdownSharedTestApp(): Promise<void> {
  if (!shared) return;
  await shared.app.close();
  shared = null;
}
