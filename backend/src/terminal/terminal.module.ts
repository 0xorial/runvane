import { Module } from '@nestjs/common';
import { TerminalGateway } from './terminal.gateway.js';

@Module({
  providers: [TerminalGateway],
})
export class TerminalModule {}
