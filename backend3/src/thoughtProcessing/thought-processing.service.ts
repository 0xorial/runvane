import { Injectable } from '@nestjs/common';
import { SseType } from '../contracts/sse.js';
import { ProcessingLifecycleHandle } from '../conversations/processing-lifecycle-handle.js';
import { ChatEntriesRepo } from '../db/repositories/chat-entries.repo.js';
import { LlmProviderSettingsRepo } from '../db/repositories/llm-provider-settings.repo.js';
import { SseHubService } from '../sse/sse-hub.service.js';
import { AutoTitleThoughtTypeProvider } from './thoughtTypeProviders/autoTitleProvider.js';
import { PlannerThoughtTypeProvider } from './thoughtTypeProviders/plannerProvider.js';
import type {
  PrepareStepInput,
  ThoughtInitiationInput,
  ThoughtLifecycleStartRequest,
  ThoughtLifecycleStarted,
  ThoughtType,
  ThoughtTypeProvider,
} from './types.js';
import { PrepareStep } from './steps/prepareStep.js';

type AnyThoughtProvider = ThoughtTypeProvider<any, any, any, any>;

export type StartedThought = {
  provider: AnyThoughtProvider;
  input: PrepareStepInput;
};

@Injectable()
export class ThoughtProcessingService {
  private readonly providers: Record<ThoughtType, AnyThoughtProvider>;

  constructor(
    private readonly prepareStep: PrepareStep,
    private readonly chatEntries: ChatEntriesRepo,
    private readonly llmProviderSettings: LlmProviderSettingsRepo,
    private readonly hub: SseHubService,
    private readonly autoTitleProvider: AutoTitleThoughtTypeProvider,
    private readonly plannerProvider: PlannerThoughtTypeProvider,
  ) {
    this.providers = {
      autoTitle: this.autoTitleProvider,
      planner: this.plannerProvider,
    };
  }

  async startThought(
    conversationId: string,
    thoughtType: ThoughtType,
    signal: AbortSignal,
  ): Promise<StartedThought> {
    const provider = this.providers[thoughtType];
    if (!provider.createPrepareInput) {
      throw new Error(`provider ${thoughtType} cannot self-initiate (missing createPrepareInput)`);
    }
    if (!provider.getLifecycleStartRequest || !provider.applyLifecycleStart) {
      throw new Error(`provider ${thoughtType} is missing lifecycle hooks`);
    }
    signal.throwIfAborted();

    const initialInput = await provider.createPrepareInput({ conversationId } satisfies ThoughtInitiationInput);
    if (!initialInput) {
      throw new Error(`provider ${thoughtType} returned no prepare input for conversation ${conversationId}`);
    }
    const lifecycleRequest = provider.getLifecycleStartRequest(initialInput);
    if (!lifecycleRequest) {
      throw new Error(`provider ${thoughtType} returned no lifecycle request`);
    }
    const started = await this.precreateStepEntries(lifecycleRequest);
    const input = provider.applyLifecycleStart(initialInput, started);
    return { provider, input };
  }

  async runThought(started: StartedThought, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    await this.prepareStep.run(started.provider, started.input, signal);
  }

  async initiateThought(
    conversationId: string,
    thoughtType: ThoughtType,
    lifecycleHandle: ProcessingLifecycleHandle,
  ): Promise<void> {
    const started = await this.startThought(conversationId, thoughtType, lifecycleHandle.signal);
    await this.runThought(started, lifecycleHandle.signal);
  }

  private async precreateStepEntries(request: ThoughtLifecycleStartRequest): Promise<ThoughtLifecycleStarted> {
    const thoughtId = crypto.randomUUID();
    const llmSettings = await this.llmProviderSettings.getDocument();
    const llmProviderId = request.llmProviderId ?? llmSettings.llm_configuration.provider_id;
    const llmModel = request.llmModel ?? llmSettings.llm_configuration.model_name;
    const conversationId = request.conversationId;

    const prepareEntry = await this.chatEntries.appendThoughtPrepareEntry(conversationId, {
      thoughtId,
      requestText: request.llmRequest,
      parentId: request.parentId,
      status: 'running',
      title: request.summary,
      llmProviderId,
      llmModel,
    });
    await this.publishUpsert(conversationId, prepareEntry.id);

    const streamEntry = await this.chatEntries.appendThoughtStreamEntry(conversationId, {
      type: request.kind === 'title' ? 'title_llm_stream' : 'planner_llm_stream',
      thoughtId,
      parentId: prepareEntry.id,
      llmRequest: request.llmRequest,
      status: 'running',
      llmProviderId,
      llmModel,
    });

    const streamPayload = await this.chatEntries.getChatEntry(conversationId, streamEntry.id);
    if (streamPayload) {
      const startingPayload: {
        type: typeof SseType.TITLE_STARTING | typeof SseType.PLANNER_STARTING;
        chatEntryId: string;
        thoughtId: string;
        conversationIndex: number;
        createdAt: string;
        parentId: string | null;
        requestText: string;
        llmProviderId?: string;
        llmModel?: string;
      } = {
        type: request.kind === 'title' ? SseType.TITLE_STARTING : SseType.PLANNER_STARTING,
        chatEntryId: streamEntry.id,
        thoughtId,
        conversationIndex: streamPayload.conversationIndex,
        createdAt: streamPayload.createdAt,
        parentId: streamPayload.parentId,
        requestText: request.llmRequest,
      };
      if (llmProviderId) startingPayload.llmProviderId = llmProviderId;
      if (llmModel) startingPayload.llmModel = llmModel;
      this.hub.publish(conversationId, startingPayload);
    }

    if (!request.includeAction) {
      return {
        thoughtId,
        prepareEntryId: prepareEntry.id,
        streamEntryId: streamEntry.id,
        thoughtActionEntryId: null,
      };
    }

    const thoughtActionEntry = await this.chatEntries.appendThoughtActionEntry(conversationId, {
      thoughtId,
      parentId: streamEntry.id,
      status: 'running',
      summary: request.summary ?? 'Waiting for LLM output',
    });
    await this.publishUpsert(conversationId, thoughtActionEntry.id);

    return {
      thoughtId,
      prepareEntryId: prepareEntry.id,
      streamEntryId: streamEntry.id,
      thoughtActionEntryId: thoughtActionEntry.id,
    };
  }

  private async publishUpsert(conversationId: string, entryId: string): Promise<void> {
    const entry = await this.chatEntries.getChatEntry(conversationId, entryId);
    if (!entry) return;
    this.hub.publish(conversationId, { type: SseType.CHAT_ENTRY_UPSERT, entry });
  }
}
