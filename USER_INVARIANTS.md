# USER_INVARIANTS

| ID | Mandate | Enforcement sites |
| --- | --- | --- |
| RV-005 | Keep one chat shell for `/chat/new` and `/chat/:conversationId` so switching `new -> id` does not remount the page/state. | `frontend/src/App.tsx`, `frontend/src/chatLive/conversationStreamContract.ts` |
| RV-006 | On chat switch, run one messages fetch; runs/steps/approvals should come from SSE updates. | `frontend/src/chatLive/README.md` |
| RV-010 | LM Studio provider must expose only loaded LLM models in provider settings model lists. | `backend/src/llm_provider/providers/lmStudioNative.ts` |
| RV-011 | LM Studio integration must use LM Studio native API endpoint shape (`/api/v1/chat`) instead of OpenAI-compatible `/v1/chat/completions`. | `backend/src/llm_provider/providers/lmStudioNative.ts` |
| RV-012 | Global model selector must persist both `llm_configuration.model_name` and matching `llm_configuration.provider_id`. | `frontend/src/pages/settings/GlobalModelSettingsCard.tsx` |
| RV-013 | Auto-title generation must reject JSON-like/brace-only garbage outputs and fallback to first-message title. | `backend/src/bootstrap/runtime/autoTitle.ts` |
| RV-014 | LLM request payload must include global/preset model parameters (including client-provided structured output schema) when invoking providers. | `backend/src/domain/continueConversationTaskProcessor.ts`, `backend/src/llm_provider/providers/openAiCompatible.ts`, `backend/src/llm_provider/providers/lmStudioNative.ts` |
