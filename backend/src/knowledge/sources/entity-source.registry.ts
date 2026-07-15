import { Inject, Injectable } from '@nestjs/common';
import { ENTITY_SOURCES, type EntitySource } from './entity-source.js';

export type EntitySourceInfo = { type: string; label: string };

/** Resolves entity sources by type and lists them for the config UI. */
@Injectable()
export class EntitySourceRegistry {
  private readonly byType = new Map<string, EntitySource>();

  constructor(@Inject(ENTITY_SOURCES) sources: EntitySource[]) {
    for (const source of sources) this.byType.set(source.type, source);
  }

  get(type: string): EntitySource | null {
    return this.byType.get(type) ?? null;
  }

  list(): EntitySourceInfo[] {
    return [...this.byType.values()].map((s) => ({ type: s.type, label: s.label }));
  }
}
