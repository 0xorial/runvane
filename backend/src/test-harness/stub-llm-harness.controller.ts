import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { StubLlmProvider } from '../llmProviders/providers/stubLlm.js';

const QueuedResponseSchema = z.object({
  text: z.string(),
  streamMs: z.number().int().min(0).max(60_000).optional(),
});

const ModelScriptSchema = z.object({
  model: z.string().min(1).optional(),
  responses: z.array(QueuedResponseSchema).min(1),
});

const ConfigureBodySchema = z.object({
  scripts: z.array(ModelScriptSchema).min(1),
  append: z.boolean().optional(),
});

const SetNextBodySchema = z.object({ text: z.string() });
const SetNextManyBodySchema = z.object({ texts: z.array(z.string()).min(1) });

@Controller('test/stub-llm')
export class StubLlmHarnessController {
  constructor(private readonly stubLlm: StubLlmProvider) {}

  @Post('configure')
  @HttpCode(200)
  configure(@Body() body: unknown) {
    const { scripts, append } = ConfigureBodySchema.parse(body);
    this.stubLlm.configure(scripts, { append });
    return { ok: true as const, pending: this.stubLlm.pendingCount() };
  }

  @Post('set-next-response')
  @HttpCode(200)
  setNext(@Body() body: unknown) {
    const { text } = SetNextBodySchema.parse(body);
    this.stubLlm.setNextResponse(text);
    return { ok: true as const, pending: this.stubLlm.pendingCount() };
  }

  @Post('set-next-responses')
  @HttpCode(200)
  setNextMany(@Body() body: unknown) {
    const { texts } = SetNextManyBodySchema.parse(body);
    this.stubLlm.setNextResponses(...texts);
    return { ok: true as const, pending: this.stubLlm.pendingCount() };
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    this.stubLlm.reset();
    return { ok: true as const };
  }
}
