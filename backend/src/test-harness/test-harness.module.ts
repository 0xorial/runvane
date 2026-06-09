import { Module } from '@nestjs/common';
import { StubLlmHarnessController } from './stub-llm-harness.controller.js';

@Module({
  controllers: [StubLlmHarnessController],
})
export class TestHarnessModule {}
