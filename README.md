# CareerPilot AI — Stage 2 (Free AI CV analyzer, powered by Google Gemini)

This is the same Stage 2 as before, but rebuilt to use **Google Gemini's free API** instead of OpenAI — so testing costs nothing.

## What works in this stage
- Upload a PDF or DOCX CV
- Optional job description box
- Server reads the CV text itself (no file is ever saved to disk)
- Real AI-powered analysis: ATS score, job match score, strengths, weaknesses, missing keywords, improvement suggestions, experience/skills/formatting quality

## Not in this stage yet
Login/signup, Free/Pro daily limits, payments, ads, and deployment to a live domain. Those come one stage at a time.

## Get your FREE Gemini API key (no card needed)

1. Go to https://aistudio.google.com/apikey
2. Sign in with any Google account.
3. Click **"Create API key"**, pick or create a project, and copy the key that appears.
4. This key has **no billing requirement** — it works immediately on the free tier.

## Setup on Windows

1. Install **Node.js LTS** (free) from https://nodejs.org if you haven't already.
2. Extract this ZIP somewhere new, e.g. `Documents\CareerPilotAI-Gemini` (don't extract it into the old OpenAI folder — keep them separate).
3. Open the extracted folder, Shift + right-click inside it, choose **"Open PowerShell window here"**.
4. Run:
   ```
   npm install
   ```
5. Copy `.env.example` to a new file named `.env`. Open it in Notepad and paste your Gemini key after `GEMINI_API_KEY=`:
   ```
   GEMINI_API_KEY=AIzaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   GEMINI_MODEL=gemini-2.5-flash
   PORT=3000
   ```
6. Run:
   ```
   npm start
   ```
   You should see: `CareerPilot AI running at http://localhost:3000`
7. Open that address in your browser, upload a CV, and click **Analyze with AI**.

## Free tier — what to know

- **Rate limits:** the free tier allows a limited number of requests per minute/day (fine for solo testing). If you see a 429 error, wait a minute and try again. Current numbers: https://ai.google.dev/gemini-api/docs/rate-limits
- **Privacy trade-off:** on the free tier, Google may use submitted content to improve their products. This is fine while you're testing with your own CV. Before real users upload their CVs on the live site, revisit whether to move to a paid tier (OpenAI or Gemini's paid tier) for stronger privacy guarantees.
- **No card required** for this free key, unlike OpenAI.

## If something goes wrong
- **"GEMINI_API_KEY is not configured"** — `.env` is missing or the key wasn't saved. Re-check step 5, then stop the server (Ctrl+C) and run `npm start` again.
- **400 error** — the key was typed wrong.
- **429 error** — free-tier rate limit hit. Wait a minute, or check quota at https://aistudio.google.com
- **"Could not read enough text from this file"** — the PDF is a scanned image rather than real text. Try exporting as text-based PDF or .docx.
