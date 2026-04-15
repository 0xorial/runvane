import { Conversation, ToolDefinition } from "@/types/agent";

export const mockTools: ToolDefinition[] = [
  {
    id: "1",
    name: "file_read",
    description: "Read contents of a file from the filesystem",
    permission: "allow",
    category: "Filesystem",
  },
  {
    id: "2",
    name: "file_write",
    description: "Write or overwrite a file on the filesystem",
    permission: "ask",
    category: "Filesystem",
  },
  {
    id: "3",
    name: "shell_exec",
    description: "Execute a shell command and return output",
    permission: "ask",
    category: "System",
  },
  {
    id: "4",
    name: "web_search",
    description: "Search the web and return results",
    permission: "allow",
    category: "Web",
  },
  {
    id: "5",
    name: "web_fetch",
    description: "Fetch a URL and return its content",
    permission: "allow",
    category: "Web",
  },
  {
    id: "6",
    name: "db_query",
    description: "Execute a read-only SQL query against the database",
    permission: "allow",
    category: "Database",
  },
  {
    id: "7",
    name: "db_mutate",
    description: "Execute a write SQL query (INSERT, UPDATE, DELETE)",
    permission: "ask",
    category: "Database",
  },
  {
    id: "8",
    name: "code_interpret",
    description: "Run Python code in a sandboxed environment",
    permission: "allow",
    category: "Code",
  },
  {
    id: "9",
    name: "send_email",
    description: "Send an email via configured SMTP",
    permission: "forbid",
    category: "Communication",
  },
];

export const mockConversations: Conversation[] = [
  {
    id: "1",
    title: "Refactor auth middleware",
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now() - 1800000,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Can you help me refactor the authentication middleware? It's become a mess with too many edge cases.",
        timestamp: Date.now() - 3600000,
      },
      {
        id: "m2",
        role: "assistant",
        content: "I'll analyze the current middleware structure. Let me read the auth files first.",
        timestamp: Date.now() - 3590000,
        llmRequest: {
          id: "llm1",
          model: "claude-sonnet-4-20250514",
          promptTokens: 1240,
          completionTokens: 89,
          timestamp: Date.now() - 3590000,
          durationMs: 1200,
          status: "completed",
        },
        toolCalls: [
          {
            id: "tc1",
            toolName: "file_read",
            args: { path: "src/middleware/auth.ts" },
            result: "// Auth middleware with 340 lines...",
            status: "completed",
            startedAt: Date.now() - 3589000,
            completedAt: Date.now() - 3588000,
          },
        ],
      },
      {
        id: "m3",
        role: "assistant",
        content:
          "I've analyzed the middleware. Here's what I found:\n\n1. **Token validation** is duplicated across 3 functions\n2. **Error handling** is inconsistent — some paths throw, others return null\n3. **Rate limiting** logic is mixed into auth checks\n\nI recommend extracting these into separate concerns. Want me to proceed with the refactor?",
        timestamp: Date.now() - 3580000,
        llmRequest: {
          id: "llm2",
          model: "claude-sonnet-4-20250514",
          promptTokens: 2800,
          completionTokens: 340,
          timestamp: Date.now() - 3580000,
          durationMs: 2100,
          status: "completed",
        },
      },
    ],
  },
  {
    id: "2",
    title: "Deploy to production",
    createdAt: Date.now() - 600000,
    updatedAt: Date.now() - 60000,
    messages: [
      {
        id: "m10",
        role: "user",
        content: "Deploy the latest build to production and run the database migration.",
        timestamp: Date.now() - 600000,
      },
      {
        id: "m11",
        role: "assistant",
        content:
          "I'll start by running the build, then execute the migration and deploy. Let me check the current status first.",
        timestamp: Date.now() - 590000,
        llmRequest: {
          id: "llm10",
          model: "claude-sonnet-4-20250514",
          promptTokens: 980,
          completionTokens: 64,
          timestamp: Date.now() - 590000,
          durationMs: 900,
          status: "completed",
        },
        toolCalls: [
          {
            id: "tc10",
            toolName: "shell_exec",
            args: { command: "npm run build" },
            result:
              "Build completed successfully in 12.4s\n✓ 847 modules transformed\n✓ dist/index.html  1.2 kB\n✓ dist/assets/index-abc123.js  248 kB",
            status: "completed",
            startedAt: Date.now() - 589000,
            completedAt: Date.now() - 576000,
          },
        ],
      },
      {
        id: "m12",
        role: "assistant",
        content:
          "Build succeeded. Now I need to run the database migration. This will alter the `users` table and add a new `sessions` table. I need your approval since this modifies the database.",
        timestamp: Date.now() - 570000,
        llmRequest: {
          id: "llm11",
          model: "claude-sonnet-4-20250514",
          promptTokens: 3200,
          completionTokens: 120,
          timestamp: Date.now() - 570000,
          durationMs: 1400,
          status: "completed",
        },
        toolCalls: [
          {
            id: "tc11",
            toolName: "db_mutate",
            args: {
              query:
                "ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP;\nCREATE TABLE sessions (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id UUID REFERENCES users(id) ON DELETE CASCADE,\n  token TEXT NOT NULL,\n  expires_at TIMESTAMP NOT NULL,\n  created_at TIMESTAMP DEFAULT now()\n);",
            },
            status: "awaiting_approval",
            startedAt: Date.now() - 569000,
          },
        ],
      },
    ],
  },
  {
    id: "3",
    title: "Database migration plan",
    createdAt: Date.now() - 86400000,
    updatedAt: Date.now() - 80000000,
    messages: [],
  },
  {
    id: "4",
    title: "API rate limiter design",
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now() - 170000000,
    messages: [],
  },
];
