# Runvane

Long live context engineering!

Personal AI chat client focused on local-first control, flexible orchestration, and transparent runtime behavior.

## Why

- keep as much data local as possible
- avoid vendor lock-in
- customize tools, permissions, and execution flow
- get all the flexibility you want in context engineering

## Stack

[![Backend: NestJS + Express](https://img.shields.io/badge/backend-NestJS%20%2B%20Express-E0234E)](#)
[![Frontend: Svelte + Vite](https://img.shields.io/badge/frontend-Svelte%20%2B%20Vite-ff3e00)](#)
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
- api tool (backend introspection: tools, agents, presets, tasks)
- conversations tool (read chat history and conversation metadata)
- filesystem tools (`filesystem`, `filesystem_index`)
- import chat history from OpenAI, Gemini, Claude, and Grok (`POST /api/import/auto` auto-detects format)

## Planned features

- multi-model compare at scale (reason step already supports branch-with-different-model)
- token/time/price quotes for chats/messages
- import UI and bulk migration helpers; LLM-assisted import for arbitrary exports
- terminal connectors — single connector tool, mirror terminal in the UI (local, SSH, serial/UTM)

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
# Frontend (Svelte)
cd frontend
npm install
npm run dev
npm run test:e2e
```

## Roadmap

- additional import formats and bulk migration helpers
