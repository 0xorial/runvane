import { test as base } from "@playwright/test";
import { RunvaneApp } from "./pages/RunvaneApp";

export const test = base.extend<{ app: RunvaneApp }>({
  app: async ({ page }, use) => {
    await use(new RunvaneApp(page));
  },
});

export { expect } from "@playwright/test";
