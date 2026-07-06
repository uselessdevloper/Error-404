# TaskPilot AI — Deployment Guide

## Backend → Render

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect your GitHub repo `KishuSInha/Error-404`
3. Set these values:
   - **Root Directory:** `backend/taskpilotai`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.mjs`
   - **Runtime:** Node
   - **Plan:** Free

4. Add Environment Variables in Render dashboard (Environment tab):

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | your key from aistudio.google.com |
| `LLM_PROVIDER` | `gemini` |
| `LLM_MODEL` | `gemini-2.5-flash` |
| `SUPABASE_URL` | your supabase project URL |
| `SUPABASE_ANON_KEY` | your supabase anon key |
| `SUPABASE_SERVICE_KEY` | your supabase service role key |
| `TASKPILOT_DATASET_DIR` | `./datasets` |
| `NODE_ENV` | `production` |

5. After deploy, copy your Render URL e.g. `https://taskpilot-ai-backend.onrender.com`

---

## Frontend → Vercel

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import GitHub repo `KishuSInha/Error-404`
3. Set these values:
   - **Root Directory:** `frontend/taskpilotai`
   - **Build Command:** `node scripts/build.mjs`
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
   - **Framework Preset:** Other

4. Add Environment Variables in Vercel dashboard:

| Key | Value |
|-----|-------|
| `VITE_BACKEND_URL` | your Render URL from above |

5. Deploy — Vercel auto-deploys on every push to `utkarsh` branch.

---

## After Deploy

- Frontend: `https://taskpilot-ai.vercel.app`
- Backend API: `https://taskpilot-ai-backend.onrender.com/api/taskpilot/data`

> Note: Render free tier spins down after 15min of inactivity. First request after sleep takes ~30s to wake up.
