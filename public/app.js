const cv = document.getElementById("cv");
const nameBox = document.getElementById("fileName");
const status = document.getElementById("status");

const analyzeBtn = document.getElementById("analyze");
const coverLetterBtn = document.getElementById("coverLetterBtn");
const interviewBtn = document.getElementById("interviewBtn");
const allButtons = [analyzeBtn, coverLetterBtn, interviewBtn];

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

    status.textContent =
      typeof data.remaining === "number"
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