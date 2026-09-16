const cv = document.getElementById("cv");
const nameBox = document.getElementById("fileName");
const status = document.getElementById("status");

const analyzeBtn = document.getElementById("analyze");
const coverLetterBtn = document.getElementById("coverLetterBtn");
const interviewBtn = document.getElementById("interviewBtn");
const allButtons = [analyzeBtn, coverLetterBtn, interviewBtn];

const proBadge = document.getElementById("proBadge");
const getProBtn = document.getElementById("getProBtn");
const restoreToggle = document.getElementById("restoreToggle");
const restoreForm = document.getElementById("restoreForm");
const restoreEmail = document.getElementById("restoreEmail");
const restoreBtn = document.getElementById("restoreBtn");
const restoreStatus = document.getElementById("restoreStatus");

let isPro = false;

async function initProState() {
  try {
    const [meRes, configRes] = await Promise.all([fetch("/api/me"), fetch("/api/config")]);
    const me = await meRes.json();
    const config = await configRes.json();

    if (config.buyLink && getProBtn) getProBtn.href = config.buyLink;

    isPro = !!me.isPro;
    if (isPro && proBadge) {
      proBadge.textContent = `✦ Pro member — unlimited access (${me.email})`;
      proBadge.classList.remove("hidden");
    }
  } catch {
    // Badge/buy-link just won't show — core features still work either way.
  }
}
initProState();

if (restoreToggle) {
  restoreToggle.addEventListener("click", () => restoreForm.classList.toggle("hidden"));
}

if (restoreBtn) {
  restoreBtn.addEventListener("click", async () => {
    const email = restoreEmail.value.trim();
    if (!email) {
      restoreStatus.textContent = "Please enter your email.";
      return;
    }
    restoreBtn.disabled = true;
    restoreStatus.textContent = "Checking…";
    try {
      const r = await fetch("/api/unlock-pro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Could not verify.");
      restoreStatus.textContent = "✓ Pro unlocked! Reloading…";
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      restoreStatus.textContent = e.message;
    } finally {
      restoreBtn.disabled = false;
    }
  });
}

cv.addEventListener("change", () => {
  nameBox.textContent = cv.files[0] ? `Selected: ${cv.files[0].name}` : "";
});

async function callAI(endpoint, activeBtn, busyLabel, idleLabel) {
  if (!cv.files[0]) {
    status.textContent = "Please choose your CV first.";
    return null;
  }

  allButtons.forEach((b) => (b.disabled = true));
  activeBtn.textContent = busyLabel;
  status.textContent = "Reading your CV and preparing your report…";

  const fd = new FormData();
  fd.append("cv", cv.files[0]);
  fd.append("jobDescription", document.getElementById("job").value);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const r = await fetch(endpoint, { method: "POST", body: fd, signal: controller.signal });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");

    status.textContent = data.isPro
      ? "✦ Pro — unlimited"
      : typeof data.remaining === "number"
      ? `${data.remaining} free use${data.remaining === 1 ? "" : "s"} left today`
      : "";
    return data;
  } catch (e) {
    status.textContent =
      e.name === "AbortError"
        ? "This is taking too long. Check your internet connection and try again."
        : e.message;
    return null;
  } finally {
    clearTimeout(timeoutId);
    allButtons.forEach((b) => (b.disabled = false));
    activeBtn.textContent = idleLabel;
  }
}

analyzeBtn.addEventListener("click", async () => {
  const data = await callAI("/api/analyze", analyzeBtn, "AI is analyzing…", "Analyze with AI →");
  if (!data) return;
  renderAnalysis(data);
  document.getElementById("results").classList.remove("hidden");
  document.getElementById("results").scrollIntoView({ behavior: "smooth" });
});

coverLetterBtn.addEventListener("click", async () => {
  const data = await callAI("/api/cover-letter", coverLetterBtn, "Writing…", "Generate Cover Letter →");
  if (!data) return;
  document.getElementById("coverLetterText").textContent = data.coverLetter;
  document.getElementById("coverLetterResult").classList.remove("hidden");
  document.getElementById("coverLetterResult").scrollIntoView({ behavior: "smooth" });
});

interviewBtn.addEventListener("click", async () => {
  const data = await callAI("/api/interview-questions", interviewBtn, "Preparing…", "Interview Questions →");
  if (!data) return;
  renderInterviewQuestions(data.questions);
  document.getElementById("interviewResult").classList.remove("hidden");
  document.getElementById("interviewResult").scrollIntoView({ behavior: "smooth" });
});

document.getElementById("copyCoverLetter").addEventListener("click", () => {
  const text = document.getElementById("coverLetterText").textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copyCoverLetter");
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1500);
  });
});

function renderAnalysis(d) {
  document.getElementById("ats").textContent = d.atsScore ?? "—";
  document.getElementById("match").textContent = d.jobMatchScore == null ? "—" : d.jobMatchScore + "%";
  document.getElementById("exp").textContent = (d.experienceQuality ?? "—") + "%";
  document.getElementById("skills").textContent = (d.skillsQuality ?? "—") + "%";
  document.getElementById("summary").textContent = d.summary || "";
  listItems("strengths", d.strengths);
  listItems("weaknesses", d.weaknesses);
  listItems("keywords", d.missingKeywords);
  listItems("improvements", d.improvements);
}

function renderInterviewQuestions(questions) {
  const container = document.getElementById("interviewList");
  container.innerHTML = (questions || [])
    .map(
      (q, i) =>
        `<div class="qa-item"><b>${i + 1}. ${escapeHtml(q.question)}</b><p>${escapeHtml(q.tip)}</p></div>`
    )
    .join("");
}

function listItems(id, items) {
  document.getElementById(id).innerHTML =
    (items || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("") || "<li>None identified.</li>";
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c])
  );
}