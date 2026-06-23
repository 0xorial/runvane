import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/**
 * In-memory mirror of the DB `stream_cursor` (the global monotonic seq bumped
 * in the same txn as every chat_entries mutation). Initialised from the DB on
 * boot and advanced via `note()` with each mutation's committed value.
 *
 * The hub reads `current()` to stamp live events — cheap and sync, no per-event
 * DB read. The snapshot does NOT use this mirror: it reads the DB cursor inside
 * the same consistent txn as the entries, so its watermark exactly matches the
 * entries it returns. The mirror only needs to be monotonic and ≥ the latest
 * committed seq (it is, since `note()` runs after each bump commits), which is
 * enough for the client's `seq > W` gate.
 */
@Injectable()
export class StreamCursorService implements OnModuleInit {
  private value = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const rows = (await this.prisma.$queryRawUnsafe(
        `SELECT value FROM stream_cursor WHERE id = 0`,
      )) as Array<{ value: number }>;
      this.value = Number(rows[0]?.value ?? 0);
    } catch {
      // Table may not exist in some bare test DBs; start from 0.
      this.value = 0;
    }
  }

  /** Latest known cursor value — the seq stamped on live events. */
  current(): number {
    return this.value;
  }

  /** Advance the mirror to a value produced by a committed mutation's bump. */
  note(seq: number): void {
    if (seq > this.value) this.value = seq;
  }
}
