# Definitions

## Conversation

A sequence of chat events. In reality it is a tree because old events may be modified creating a new branches of agentic activity.

Current event types:

- **thought**: a 3-stage LLM reasoning cycle (defined below)
- **tool invocation**: framework-triggered tool execution
- **agent response**: text shown to the user

## Thought

A thought is one framework-managed LLM cycle (planning, title generation, or other reasoning task).

It has 3 stages:

1. **Context preparation**  
   Build model input from conversation history and runtime params (including selected model).  
   **properties:** input params, generated context payload.

2. **LLM query**  
   Send prepared input to the model.  
   **properties:** raw LLM text output (metrics can be added later).

3. **Framework interpretation**  
   Convert LLM text into a structured next action.  
   **properties:** interpretation JSON.

Possible outcomes of framework interpretation:

- create user-facing response
- create tool requests
- invoke tools
- mark error / invalid model output

## MCP vs this framework

Mindset difference:

- **MCP-first mindset**: abstract and normalize interactions with models/tools behind a common protocol.
- **This framework mindset**: keep the runtime explicit and controllable at every stage, while still allowing agentic behavior.

So, MCP is about interoperability; this framework is about orchestration control.
