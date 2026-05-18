# 🎯 NTA JEE Simulator — Full System

A complete, offline-capable CBT (Computer Based Test) platform for JEE and other competitive exam practice. The system has two tools that work together:

| Tool | What it does | Link |
|------|-------------|------|
| **Exam Creator** | Convert PDFs / raw text into question paper JSON, add images, fix answers | [exam-creator](https://rahul-v-prijeesh.github.io/exam-creator/) |
| **NTA Simulator** | Take the exam in a CBT interface, get analytics, track history | [nta-simulator](https://rahul-v-prijeesh.github.io/nta-simulator/) |

---

## 🔄 The Full Workflow

```
PDF / Question Paper
       ↓
 Extract text (AI or Ollama)
       ↓
 Exam Creator — clean up, add images, set answers
       ↓
 Export as JSON or ZIP
       ↓
 NTA Simulator — take the test, review, analyse
```

---

## 🤖 Step 1 — Extract Questions from a PDF

You have two options:

### Option A — Use Any AI (No GPU needed ✅)

Copy the text from your PDF and paste it into **Claude**, **ChatGPT**, or **Gemini** with this prompt:

```
Convert the following JEE question paper text into a JSON array.
Each question must follow this exact format:

{
  "id": 1,
  "section": "Physics",
  "type": "single",
  "question": "Question text here",
  "options": ["Option A text", "Option B text", "Option C text", "Option D text"],
  "correct_answer": ["B"],
  "marks": { "correct": 4, "incorrect": -1 }
}

Rules:
- type must be exactly: "single", "multiple", or "numerical"
- For numerical questions, set options to null and correct_answer to the number as a string e.g. "42"
- For multiple correct, correct_answer is an array e.g. ["A", "C"]
- options must contain the actual answer text, never just ["A","B","C","D"]
- Output ONLY the raw JSON array, no explanation, no markdown fences

Here is the question paper text:
[PASTE YOUR TEXT HERE]
```

Save the output as a `.json` file and open it in the **Exam Creator**.

### Option B — Use Ollama (Local AI, GPU recommended)

If you have Ollama running locally, the **Exam Creator** has a built-in PDF parser. Just:

1. Start Ollama: `OLLAMA_ORIGINS=* ollama serve`
2. Pull a model: `ollama pull qwen2.5:3b`
3. Open Exam Creator, connect to Ollama, and drop your PDF

**Recommended models:**

| Hardware | Model |
|----------|-------|
| 4GB+ GPU | `qwen2.5:3b`, `gemma2:2b` |
| CPU only | `tinyllama` |

---

## 🛠 Step 2 — Clean Up in Exam Creator

Open [exam-creator](https://rahul-v-prijeesh.github.io/exam-creator/) and import your JSON or ZIP file.

**What you can do:**
- ✏️ Fix OCR errors in question text and options
- 🖼 Attach images to questions and individual options
- ✅ Set or correct the correct answer for each question
- 🤖 Auto-solve unanswered questions using Ollama
- 🏷 Set section names, marks, and question types
- ➕ Add or delete questions manually

When done, export as **JSON** (no images) or **ZIP** (with images).

---

## 🧪 Step 3 — Take the Test in NTA Simulator

Open [nta-simulator](https://rahul-v-prijeesh.github.io/nta-simulator/) and load your JSON or ZIP file.

**Features:**
- ⏱ Timed exam with auto-submit
- 💾 Auto-save every 5 seconds — resume interrupted sessions
- 🔢 All JEE question types — Single, Multi correct, Numerical
- 🖼 Image support for questions and options
- ✏️ Scratch pad for rough work
- 🚩 Flag and bookmark questions
- 📊 Detailed results — section-wise accuracy, time per question, score trends
- 📋 Test history — last 50 attempts with full review
- 📁 Export history as JSON

---

## 📄 JSON Format Reference

The format used across both tools:

```json
{
  "exam": {
    "title": "JEE Advanced 2024 — Paper 1",
    "duration_minutes": 180,
    "sections": ["Physics", "Chemistry", "Mathematics"]
  },
  "questions": [...]
}
```

### Single Correct
```json
{
  "id": 1,
  "section": "Physics",
  "type": "single",
  "question": "What is the SI unit of force?",
  "options": ["Joule", "Newton", "Pascal", "Watt"],
  "correct_answer": ["B"],
  "images": null,
  "marks": { "correct": 4, "incorrect": -1 }
}
```

### Multiple Correct
```json
{
  "id": 2,
  "section": "Mathematics",
  "type": "multiple",
  "question": "Which of these are prime numbers?",
  "options": ["2", "4", "7", "9"],
  "correct_answer": ["A", "C"],
  "images": null,
  "marks": { "correct": 4, "incorrect": -2 }
}
```

### Numerical
```json
{
  "id": 3,
  "section": "Chemistry",
  "type": "numerical",
  "question": "The pH of pure water at 25°C is ____",
  "options": null,
  "correct_answer": "7",
  "images": null,
  "marks": { "correct": 4, "incorrect": 0 }
}
```

> For multiple valid answers use: `"correct_answer": "3 or 3.0 or 3.00"`

---

## 🖼 Adding Images

### Via Exam Creator (recommended)
Drop images directly onto questions or individual options inside the editor. Export as ZIP and the images are bundled automatically.

### Via ZIP manually

```
my_exam.zip
├── questions.json
└── images/
    ├── q1_diagram.png
    └── q2_graph.png
```

Reference in JSON:
```json
{ "images": ["images/q1_diagram.png"] }
```

Options with images:
```json
{
  "options": [
    "Plain text option",
    { "text": "Option with image", "image": "images/opt_b.png" },
    { "text": "", "image": "images/opt_c.png" }
  ]
}
```

---

## 📊 Scoring Logic

| Type | All correct | Partial (no wrong) | Any wrong | Unattempted |
|------|-------------|-------------------|-----------|-------------|
| Single | +4 | — | −1 | 0 |
| Multiple | +4 | +1 per correct | −2 | 0 |
| Numerical | +4 | — | 0 | 0 |

> All marks are configurable per question via the `marks` field.

---

## 🗂 Question Palette Legend (Simulator)

| Colour | Meaning |
|--------|---------|
| ⬜ Grey | Not visited |
| 🔴 Red | Visited but not answered |
| 🟢 Green | Answered |
| 🟣 Purple | Marked for review |
| 🔵 Blue | Answered and marked |

---

## 📦 Tech Stack

- **React** — both tools, no backend
- **JSZip** — ZIP bundling and extraction
- **PDF.js** — PDF text and image extraction (Exam Creator)
- **Ollama** — local LLM for PDF parsing and auto-solve (optional)
- **localStorage** — session persistence and history (Simulator)
- Zero server, zero login, works fully offline after first load

---

## 💡 Tips

- **Section names** in `exam.sections` must exactly match the `section` field on each question
- **Option labels** are A, B, C, D — `correct_answer` uses these letters, not the option text
- **IDs** must be unique integers
- You can mix question types freely within the same section
- The Simulator has a built-in demo exam — load it without any file to try it out
- If your PDF is a scanned image, use an OCR tool first before passing to an AI

---

## 🤝 Contributing

PRs are welcome. If you create a question paper JSON for a specific exam, feel free to add it to the `examples/` folder via PR.

---

*Built for students, by a student. Good luck. 🚀*
