import { Injectable } from '@nestjs/common';
import { zerialize } from 'zodex';
import { BaseTool, type ToolRunContext } from '../../base-tool.js';
import { RetrieverService } from '../../../rag/retrieval/retriever.service.js';
import { parseRagToolParams, ragToolParamsSchema, type RagToolParams } from './params.js';
import { parseRagToolRules, RagToolRulesSchema, type RagToolRules } from './rules.js';

@Injectable()
export class RagTool extends BaseTool<RagToolParams, RagToolRules> {
  constructor(private readonly retriever: RetrieverService) {
    super();
  }

  getName(): string {
    return 'rag';
  }

  getAiDescription(): string {
    return (
      'Semantic retrieval over the agent\'s configured RAG storages. Returns the most relevant ' +
      'indexed text chunks with their source and similarity score. Prefer this over keyword search ' +
      'when you need meaning-based recall rather than an exact substring.'
    );
  }

  getHumanDescription(): string {
    return 'Semantic search over configured RAG storages.';
  }

  getParamsSchema(): unknown {
    return ragToolParamsSchema();
  }

  getRulesSchema(): unknown {
    return zerialize(RagToolRulesSchema);
  }

  getDefaultRules(): RagToolRules {
    return { storages: [], top_k: 8, strategy: 'simple' };
  }

  parseParams(raw: unknown): RagToolParams {
    return parseRagToolParams(raw);
  }

  parseRules(raw: unknown): RagToolRules {
    return parseRagToolRules(raw);
  }

  async runTool(params: RagToolParams, context: ToolRunContext): Promise<unknown> {
    const rules = parseRagToolRules(context.toolRules ?? this.getDefaultRules());
    if (rules.storages.length === 0) {
      return { query: params.query, count: 0, hits: [], note: 'No RAG storages configured for this agent.' };
    }
    const topK = Math.min(params.top_k ?? rules.top_k, rules.top_k);
    const hits = await this.retriever.retrieve({
      storageIds: rules.storages,
      query: params.query,
      topK,
      signal: context.signal,
    });
    return {
      query: params.query,
      count: hits.length,
      hits: hits.map((hit) => ({
        storage: hit.storageName,
        source: typeof hit.metadata.relativePath === 'string' ? hit.metadata.relativePath : hit.sourceId,
        score: Number(hit.score.toFixed(4)),
        text: hit.text,
      })),
    };
  }
}
