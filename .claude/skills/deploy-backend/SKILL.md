---
name: deploy-backend
description: Deploy the Vercel serverless API and apply Supabase schema migrations. SCAFFOLD — refined once api/ has real endpoints and the per-viewer schema is finalized.
---

# deploy-backend

Deploys the thin relay/persistence backend.

## Status: SCAFFOLD
api/ has no endpoints yet, and supabase/schema.sql still encodes the ABANDONED chat-voting model
(must be replaced with the per-viewer seat model first). When ready, this skill will:

1. Apply the Supabase schema (run supabase/schema.sql in the Supabase SQL editor or via CLI).
2. Deploy to Vercel:
   ```powershell
   & npx vercel deploy --prod
   ```
3. Verify env vars (SUPABASE_URL, SUPABASE_SECRET_KEY, Twitch ext secret) are set in Vercel, not committed.
4. Smoke-test the auth + relay endpoints.

Guardrail: the no-logic-on-server hook warns if game logic appears under api/.
