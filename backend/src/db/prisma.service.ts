import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: {
          // Fall back to the same path Prisma migrations target (resolved
          // relative to the schema at backend/prisma). Without this match, an
          // unset DATABASE_URL opens a *different*, empty DB than the one
          // migrations built — the classic "where did my data go" footgun.
          url: process.env.DATABASE_URL ?? 'file:./prisma/backend.sqlite',
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
