# Runvane

Personal AI chat client focused on local-first control, flexible orchestration, and transparent runtime behavior.

## Why

- keep as much data local as possible
- avoid vendor lock-in
- customize tools, permissions, and execution flow

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

## Development/usage

```bash
# Backend
cd backend
npm install
npm run dev
```

```bash
# Frontend
cd frontend
npm install
npm run dev
```

## Roadmap

- import chat history from OpenAI and Gemini
