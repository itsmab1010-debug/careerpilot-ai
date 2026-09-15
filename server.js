import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Files are kept in memory only (never saved to disk) and are limited to 10 MB.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// The AI model can be changed later from .env without touching this file.
// gemini-3.6-flash is the current default (Google retired 2.5-flash for new
// accounts in 2026). If you ever hit free-tier limits or Google renames models
// again, check ai.google.dev/gemini-api/docs/models for the current option.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// --- Schemas: tell Gemini exactly what JSON shape to return for the two
// features that need structured data. The cover letter doesn't use a schema
// since it's just prose.
const analysisSchema = {
  type: "OBJECT",
  properties: {
    atsScore: { type: "NUMBER", description: "0-100" },
    jobMatchScore: { type: "NUMBER", nullable: true, description: "0-100, or null if no job description was given" },
    summary: { type: "STRING" },
    strengths: { type: "ARRAY", items: { type: "STRING" } },
    weaknesses: { type: "ARRAY", items: { type: "STRING" } },
    missingKeywords: { type: "ARRAY", items: { type: "STRING" } },
    improvements: { type: "ARRAY", items: { type: "STRING" } },
    experienceQuality: { type: "NUMBER", description: "0-100" },
    skillsQuality: { type: "NUMBER", description: "0-100" },
    formattingQuality: { type: "NUMBER", description: "0-100" }
  },
  required: [
    "atsScore", "summary", "strengths", "weaknesses",
    "missingKeywords", "improvements",
    "experienceQuality", "skillsQuality", "formattingQuality"
  ]
};

const interviewSchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      question: { type: "STRING" },
      tip: { type: "STRING", description: "Under 25 words, practical advice for answering this question" }
    },
    required: ["question", "tip"]
  }
};

// --- Simple daily limit, per device (no accounts yet — this is a placeholder
// until Stage 3 adds real login + Free/Pro plans). Shared across all three AI
// features below, since they all draw on the same Gemini quota. Resets
// automatically 24 hours after a device's first request. Lives in memory
// only, so it resets whenever the server restarts.
const FREE_DAILY_LIMIT = parseInt(process.env.FREE_DAILY_LIMIT || "3", 10);
const DAY_MS = 24 * 60 * 60 * 1000;
const usage = new Map();

function getUsageEntry(id) {
  const now = Date.now();
  const entry = usage.get(id);
  if (!entry || now - entry.windowStart > DAY_MS) {
    return { count: 0, windowStart: now };
  }
  return entry;
}

function isOverLimit(id) {
  const entry = getUsageEntry(id);
  if (entry.count >= FREE_DAILY_LIMIT) {
    const hoursLeft = Math.max(1, Math.ceil((DAY_MS - (Date.now() - entry.windowStart)) / (60 * 60 * 1000)));
    return { blocked: true, hoursLeft };
  }
  return { blocked: false };
}

// Only call this once the AI has actually responded — so a bad key, a timeout,
// or a network error never costs the user one of their daily free tries.
function recordUsage(id) {
  const now = Date.now();
  const entry = usage.get(id);
  if (!entry || now - entry.windowStart > DAY_MS) {
    usage.set(id, { count: 1, windowStart: now });
    return FREE_DAILY_LIMIT - 1;
  }
  entry.count += 1;
  return FREE_DAILY_LIMIT - entry.count;
}

// Wraps a promise so it fails with a clear message instead of hanging forever.
function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(timeoutMessage);
      err.isTimeout = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function extractText(file) {
  const name = file.originalname.toLowerCase();

  if (name.endsWith(".pdf")) {
    const parser = new PDFParse({ data: file.buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text.replace(/--\s*\d+\s*of\s*\d+\s*--/g, " ");
  }

  if (name.endsWith(".docx")) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }

  if (name.endsWith(".doc")) {
    throw new Error("Old .doc files aren't supported yet. Please save your CV as PDF or .docx and try again.");
  }

  throw new Error("Unsupported file type. Please upload a PDF or DOCX file.");
}

// Shared pipeline for all three AI features: validate key/file, extract CV
// text, enforce the daily limit, call Gemini, and send a shaped JSON response.
// buildPrompt(cvText, jobDescription) -> string
// schema: optional responseSchema for structured JSON output
// shapeResult(rawText) -> object to send back to the browser
async function handleAIRequest(req, res, { buildPrompt, schema, shapeResult }) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "The server has no GEMINI_API_KEY. Add it to the .env file and restart the server (npm start)."
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Please upload a CV file." });
    }

    let cvText;
    try {
      const extracted = await withTimeout(
        extractText(req.file),
        20000,
        "Reading the CV file took too long. Try a smaller or simpler file."
      );
      cvText = extracted.trim();
    } catch (extractError) {
      return res.status(400).json({ error: extractError.message });
    }

    if (!cvText || cvText.length < 30) {
      return res.status(400).json({
        error: "Could not read enough text from this file. Try exporting your CV as a text-based PDF or a .docx file (not a scanned image)."
      });
    }

    const jobDescription = (req.body.jobDescription || "").trim();

    // Just a check for now — the slot is only consumed once Gemini actually responds.
    const deviceId = req.ip;
    const limitStatus = isOverLimit(deviceId);
    if (limitStatus.blocked) {
      return res.status(429).json({
        error: `Free daily limit reached (${FREE_DAILY_LIMIT} uses/day). Please try again in about ${limitStatus.hoursLeft} hour(s).`
      });
    }

    const prompt = buildPrompt(cvText, jobDescription);
    const config = { temperature: 0.5 };
    if (schema) {
      config.responseMimeType = "application/json";
      config.responseSchema = schema;
    }

    const response = await withTimeout(
      ai.models.generateContent({ model: MODEL, contents: prompt, config }),
      40000,
      "The AI took too long to respond. Check your internet connection and try again."
    );

    const raw = response.text;
    if (!raw) throw new Error("Empty response from the AI model.");

    const remaining = recordUsage(deviceId);
    const result = shapeResult(raw);
    result.remaining = remaining;
    res.json(result);
  } catch (error) {
    console.error("AI request error:", error);
    if (error?.isTimeout) {
      return res.status(504).json({ error: error.message });
    }
    const status = error?.status || error?.response?.status;
    const hint =
      status === 400
        ? "Your Gemini API key looks invalid. Check the .env file."
        : status === 429
        ? "Gemini free-tier rate limit reached. Wait a minute and try again, or try again later today."
        : "AI request failed. Check the server terminal window for the detailed error.";
    res.status(status === 400 || status === 429 ? status : 500).json({ error: hint });
  }
}

app.post("/api/analyze", upload.single("cv"), async (req, res) => {
  await handleAIRequest(req, res, {
    schema: analysisSchema,
    shapeResult: (raw) => JSON.parse(raw),
    buildPrompt: (cvText, jobDescription) => `You are CareerPilot AI, a professional ATS resume analyst.
Analyze the CV text below${jobDescription ? " against the supplied job description" : ""}.
Be honest and practical, not flattering. Do not invent skills, employers, or experience
that are not present in the CV text. Keep each list item short (under 15 words), and
give 3 to 6 items per list where relevant. If no job description was given, set
jobMatchScore to null.

CV TEXT:
"""
${cvText.slice(0, 12000)}
"""
${jobDescription ? `\nJOB DESCRIPTION:\n"""\n${jobDescription.slice(0, 4000)}\n"""` : ""}`
  });
});

app.post("/api/cover-letter", upload.single("cv"), async (req, res) => {
  await handleAIRequest(req, res, {
    schema: null,
    shapeResult: (raw) => ({ coverLetter: raw.trim() }),
    buildPrompt: (cvText, jobDescription) => `You are CareerPilot AI, a professional cover letter writer.
Write a complete, ready-to-send cover letter based on the CV text below${jobDescription ? " and the target job description" : ""}.
Rules:
- 3 to 4 paragraphs, professional and confident tone, not overly flowery.
- Use only real details from the CV — never invent employers, titles, or achievements.
- If the job description names a company or role, use them naturally. Otherwise use
  the placeholders [Company Name] and [Role Title].
- Start directly with "Dear Hiring Manager," (no date or address header).
- End with a professional closing and the candidate's name from the CV.
- Return ONLY the finished cover letter text — no extra commentary, no markdown.

CV TEXT:
"""
${cvText.slice(0, 12000)}
"""
${jobDescription ? `\nJOB DESCRIPTION:\n"""\n${jobDescription.slice(0, 4000)}\n"""` : ""}`
  });
});

app.post("/api/interview-questions", upload.single("cv"), async (req, res) => {
  await handleAIRequest(req, res, {
    schema: interviewSchema,
    shapeResult: (raw) => ({ questions: JSON.parse(raw) }),
    buildPrompt: (cvText, jobDescription) => `You are CareerPilot AI, an interview preparation coach.
Based on the CV text below${jobDescription ? " and the target job description" : ""}, generate 8 realistic
interview questions this candidate is likely to be asked. For each question, give one short, practical
tip (under 25 words) on how to answer it well, referencing the candidate's actual background where relevant.
Mix general behavioral questions with a few questions specific to the candidate's field or experience.
Do not invent facts about the candidate that are not in the CV.

CV TEXT:
"""
${cvText.slice(0, 12000)}
"""
${jobDescription ? `\nJOB DESCRIPTION:\n"""\n${jobDescription.slice(0, 4000)}\n"""` : ""}`
  });
});

app.listen(port, () => {
  console.log(`CareerPilot AI running at http://localhost:${port}`);
});