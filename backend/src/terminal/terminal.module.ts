import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module.js';
import { TerminalGateway } from './terminal.gateway.js';

@Module({
  imports: [ToolsModule],
  providers: [TerminalGateway],
})
export class TerminalModule {}
