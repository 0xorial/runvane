# Runvane

Long live context engineering!

Personal AI chat client focused on local-first control, flexible orchestration, and transparent runtime behavior.

## Why

- keep as much data local as possible
- avoid vendor lock-in
- customize tools, permissions, and execution flow
- get all the flexibility you want in context engineering

## Stack

[![Backend: Node.js + Hono](https://img.shields.io/badge/backend-Node.js%20%2B%20Hono-3c873a)](#)
[![Frontend: React + Vite](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61dafb)](#)
[![Database: SQLite](https://img.shields.io/badge/database-SQLite-07405e)](#)
[![Deploy: Docker Compose](https://img.shields.io/badge/deploy-Docker%20Compose-2496ed)](#)

## Current Features

- agentic loop with tool calls and follow-up control
- SSE-driven live UI updates
- full chat history
- token and cost visibility
- configurable model/tool behavior
- message steering (abort in-flight runs and redirect)
- RAG search tool (`rag_search`)
- meta tool (tool discovery and conversation summary)
- filesystem tools (`filesystem`, `filesystem_index`)
- import chat history from OpenAI and Gemini

## Planned features

_(none — see roadmap for upcoming work)_

## Shared Definitions

- [`definitions.md`](definitions.md): canonical glossary for naming across code, docs, and agent prompts.

## Development/usage

Dev ports are allocated per project in [`dev-ports/registry.json`](dev-ports/registry.json) (100 ports per base). Change the base there, then:

```bash
node dev-ports/sync-env.mjs   # writes .env.ports for docker compose
node dev-ports/list.mjs       # show resolved ports
```

```bash
# Backend
cd backend
npm install
npm run dev
```

```bash
# Frontend (React)
cd frontend
npm install
npm run dev
```

```bash
# Frontend3 (Svelte, WIP — see docs/frontend3-parity-plan.md)
cd frontend3
npm install
npm run dev    # http://localhost:52205
npm run test:e2e
```

## Roadmap

- additional import formats and bulk migration helpers
