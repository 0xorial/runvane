import { Inject, Injectable } from '@nestjs/common';
import { GRAPH_BUILDERS, type GraphBuilder } from './graph-builder.js';

export type GraphBuilderInfo = { type: string; label: string };

/** Resolves graph builders by type and lists them for the config UI. */
@Injectable()
export class GraphBuilderRegistry {
  private readonly byType = new Map<string, GraphBuilder>();

  constructor(@Inject(GRAPH_BUILDERS) builders: GraphBuilder[]) {
    for (const builder of builders) this.byType.set(builder.type, builder);
  }

  get(type: string): GraphBuilder | null {
    return this.byType.get(type) ?? null;
  }

  list(): GraphBuilderInfo[] {
    return [...this.byType.values()].map((b) => ({ type: b.type, label: b.label }));
  }
}
