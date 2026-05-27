import { Controller, Get, HttpCode, MessageEvent, NotFoundException, Param, Post, Sse } from '@nestjs/common';
import { Observable, concat, from, interval, map, merge } from 'rxjs';
import { TaskSseType, type TaskInfo, type TaskSseEvent } from '../contracts/task.js';
import { TaskRegistryService } from './task-registry.service.js';

@Controller('api/tasks')
export class TasksController {
  constructor(private readonly registry: TaskRegistryService) {}

  @Get()
  list(): { tasks: TaskInfo[] } {
    return { tasks: this.registry.list() };
  }

  @Post(':id/cancel')
  @HttpCode(202)
  cancel(@Param('id') id: string): { id: string; cancelling: true } {
    const ok = this.registry.cancel(id);
    if (!ok) throw new NotFoundException(`task not found: ${id}`);
    return { id, cancelling: true };
  }

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    const snapshot: TaskSseEvent = { type: TaskSseType.SNAPSHOT, tasks: this.registry.list() };
    const events$ = concat(from<TaskSseEvent[]>([snapshot]), this.registry.stream()).pipe(
      map((event): MessageEvent => ({ data: event })),
    );
    const keepAlive$ = interval(15000).pipe(map((): MessageEvent => ({ type: 'ka', data: '{}' })));
    return merge(events$, keepAlive$);
  }
}
