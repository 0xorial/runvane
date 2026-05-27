import { Global, Module } from '@nestjs/common';
import { TaskRegistryService } from './task-registry.service.js';
import { TasksController } from './tasks.controller.js';

@Global()
@Module({
  controllers: [TasksController],
  providers: [TaskRegistryService],
  exports: [TaskRegistryService],
})
export class TasksModule {}
