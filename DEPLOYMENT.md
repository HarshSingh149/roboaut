# Deployment & Development Plan — Warehouse Robot Coordination Arena

## 1. Architecture Overview
- **Frontend (Digital Twin UI):** React, TypeScript, Vite, Tailwind CSS, HTML5 Canvas (60 FPS).
- **Backend (Fleet Orchestration API):** Python, FastAPI, WebSockets.
- **Core Engine:** Space-Time A* (`(x, y, time)`) with vertex + edge-swap reservation tables.

---

## 2. Local Development Setup

### Frontend
```bash
npm install
npm run dev
