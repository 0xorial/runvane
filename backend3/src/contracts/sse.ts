export interface SseEventPayloadByType {
  'conversation.created': { conversationId: string };
  'conversation.updated': { conversationId: string };
  'conversation.deleted': { conversationId: string };
  'conversation.processing.cancelled': { conversationId: string; cancelledTasks: number };
}

export type SseEventType = keyof SseEventPayloadByType;

export type SseEventEnvelope<TType extends SseEventType = SseEventType> = {
  seq: number;
  conversationId: string;
  type: TType;
  payload: SseEventPayloadByType[TType];
  createdAt: string;
};

export type AnySseEventEnvelope = SseEventEnvelope<SseEventType>;
