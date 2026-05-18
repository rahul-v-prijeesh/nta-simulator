import { useState, useEffect, useRef, useCallback } from "react";

// ─── JSZip loader ─────────────────────────────────────────────────────────────
function injectJSZip() {
  if (window.JSZip) return;
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  document.head.appendChild(s);
}
function waitForJSZip(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (window.JSZip) { resolve(window.JSZip); return; }
    const start = Date.now();
    const iv = setInterval(() => {
      if (window.JSZip) { clearInterval(iv); resolve(window.JSZip); }
      else if (Date.now() - start > timeout) { clearInterval(iv); reject(new Error("JSZip failed to load.")); }
    }, 100);
  });
}

// ─── OPTION HELPERS ───────────────────────────────────────────────────────────
function normaliseOption(raw) {
  if (raw === null || raw === undefined) return { text: "", image: null };
  if (typeof raw === "string") return { text: raw, image: null };
  return { text: raw.text ?? raw.value ?? raw.content ?? "", image: raw.image ?? null };
}
function optText(opt) {
  if (!opt) return "";
  if (typeof opt === "string") return opt;
  return opt.text ?? opt.value ?? "";
}
function optImageSrc(opt) {
  if (!opt || typeof opt === "string") return null;
  const img = opt.image;
  if (!img) return null;
  if (typeof img === "string") return img;
  return img.dataUrl || img.path || null;
}

// ─── ZIP loader ───────────────────────────────────────────────────────────────
async function resolveImageRef(imgRef, zip) {
  if (!imgRef) return null;
  if (typeof imgRef === "string") {
    const candidates = [imgRef, "images/" + imgRef.replace(/^images\//, ""), imgRef.split("/").pop()];
    for (const c of candidates) {
      const entry = zip.file(c);
      if (entry) {
        const b64 = await entry.async("base64");
        const ext = c.split(".").pop().toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
        return { path: imgRef, name: imgRef.split("/").pop(), dataUrl: `data:${mime};base64,${b64}` };
      }
    }
    return { path: imgRef, name: imgRef.split("/").pop(), dataUrl: null };
  }
  if (imgRef.dataUrl) return imgRef;
  if (imgRef.path) {
    const candidates = [imgRef.path, "images/" + imgRef.path.replace(/^images\//, ""), imgRef.name || imgRef.path.split("/").pop()];
    for (const c of candidates) {
      const entry = zip.file(c);
      if (entry) {
        const b64 = await entry.async("base64");
        const ext = c.split(".").pop().toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
        return { ...imgRef, dataUrl: `data:${mime};base64,${b64}` };
      }
    }
  }
  return imgRef;
}

async function loadZip(file) {
  const JSZip = await waitForJSZip();
  const zip = await JSZip.loadAsync(file);
  const qFile = zip.file("questions.json");
  if (!qFile) throw new Error("ZIP must contain a questions.json at its root.");
  const parsed = JSON.parse(await qFile.async("string"));
  const errs = validateExamJSON(parsed);
  if (errs.length) throw new Error("JSON validation failed:\n• " + errs.join("\n• "));
  const questions = await Promise.all(parsed.questions.map(async (q) => {
    const rawImages = !q.images ? [] : typeof q.images === "string" ? [q.images] : q.images;
    const images = await Promise.all(rawImages.map(async (img) => {
      if (img && typeof img === "object" && img.dataUrl) return img;
      const imgPath = typeof img === "string" ? img : (img.path || img.name || "");
      if (!imgPath) return img;
      const candidates = [imgPath, "images/" + imgPath.replace(/^images\//, ""), imgPath.split("/").pop()];
      for (const candidate of candidates) {
        const entry = zip.file(candidate);
        if (entry) {
          const b64 = await entry.async("base64");
          const ext = candidate.split(".").pop().toLowerCase();
          const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/png";
          return { path: imgPath, name: imgPath.split("/").pop(), dataUrl: `data:${mime};base64,${b64}` };
        }
      }
      return typeof img === "string" ? { path: img, name: img.split("/").pop(), dataUrl: null } : img;
    }));
    let options = q.options;
    if (Array.isArray(q.options)) {
      options = await Promise.all(q.options.map(async (opt) => {
        if (typeof opt === "string") return opt;
        if (!opt || !opt.image) return opt;
        const resolvedImg = await resolveImageRef(opt.image, zip);
        return { ...opt, image: resolvedImg };
      }));
    }
    return { ...q, images, options };
  }));
  return { ...parsed, questions };
}

function getImages(q) {
  if (!q.images) return [];
  const raw = typeof q.images === "string" ? [q.images] : q.images;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw.map((img, i) => {
    if (!img) return null;
    if (typeof img === "string") return { src: img, name: `Figure ${i + 1}` };
    return { src: img.dataUrl || img.path || null, name: img.name || `Figure ${i + 1}`, isDataUrl: !!img.dataUrl };
  }).filter(Boolean);
}

// ─── DEFAULT EXAM ─────────────────────────────────────────────────────────────
const DEFAULT_EXAM = {
  exam: { title: "JEE Main Mock Test – 2025", duration_minutes: 180, sections: ["Physics", "Chemistry", "Mathematics"] },
  questions: [
    { id:1,  section:"Physics",     type:"single",   question:"A particle moves in a straight line with uniform acceleration. If it covers 10 m in the 3rd second and 14 m in the 5th second, what is the acceleration?", options:["1 m/s²","2 m/s²","3 m/s²","4 m/s²"], correct_answer:["B"], images:null, marks:{correct:4,incorrect:-1} },
    { id:2,  section:"Physics",     type:"single",   question:"Two resistors of 4 Ω and 6 Ω are connected in parallel. The equivalent resistance is:", options:["10 Ω","2.4 Ω","5 Ω","1.2 Ω"], correct_answer:["B"], images:null, marks:{correct:4,incorrect:-1} },
    { id:3,  section:"Physics",     type:"numerical", question:"A ball is dropped from a height of 80 m. The time (in seconds) taken to reach the ground is ____. (g = 10 m/s²)", options:null, correct_answer:"4", images:null, marks:{correct:4,incorrect:0} },
    { id:4,  section:"Physics",     type:"single",   question:"The work done by a force F = 3î + 4ĵ N in displacing an object by d = 2î + 3ĵ m is:", options:["17 J","18 J","19 J","12 J"], correct_answer:["B"], images:null, marks:{correct:4,incorrect:-1} },
    { id:5,  section:"Physics",     type:"multiple", question:"Which of the following are vector quantities? (Select ALL that apply)", options:["Speed","Velocity","Displacement","Distance"], correct_answer:["B","C"], images:null, marks:{correct:4,partial:2,incorrect:-2} },
    { id:6,  section:"Chemistry",   type:"single",   question:"The hybridisation of carbon in CO₂ is:", options:["sp³","sp²","sp","sp³d"], correct_answer:["C"], images:null, marks:{correct:4,incorrect:-1} },
    { id:7,  section:"Chemistry",   type:"single",   question:"Which of the following elements has the highest electronegativity?", options:["Oxygen","Nitrogen","Fluorine","Chlorine"], correct_answer:["C"], images:null, marks:{correct:4,incorrect:-1} },
    { id:8,  section:"Chemistry",   type:"numerical", question:"The pH of a 0.01 M HCl solution is ____", options:null, correct_answer:"2", images:null, marks:{correct:4,incorrect:0} },
    { id:9,  section:"Chemistry",   type:"single",   question:"What is the IUPAC name of CH₃–CH(OH)–CH₃?", options:["1-propanol","2-propanol","Isopropyl alcohol","Propan-2-ol"], correct_answer:["D"], images:null, marks:{correct:4,incorrect:-1} },
    { id:10, section:"Chemistry",   type:"multiple", question:"Which reactions involve oxidation of carbon? (Select ALL that apply)", options:["CH₄ + 2O₂ → CO₂ + 2H₂O","C + O₂ → CO₂","CO + ½O₂ → CO₂","CO₂ + C → 2CO"], correct_answer:["A","B","C"], images:null, marks:{correct:4,partial:2,incorrect:-2} },
    { id:11, section:"Mathematics", type:"single",   question:"The derivative of sin(x²) with respect to x is:", options:["cos(x²)","2x·cos(x²)","2cos(x²)","x·cos(x²)"], correct_answer:["B"], images:null, marks:{correct:4,incorrect:-1} },
    { id:12, section:"Mathematics", type:"single",   question:"The sum of the series 1 + 2 + 3 + ... + 100 is:", options:["5000","5050","4950","5100"], correct_answer:["B"], images:null, marks:{correct:4,incorrect:-1} },
    { id:13, section:"Mathematics", type:"numerical", question:"If log₂(x) = 5, then x = ____", options:null, correct_answer:"32", images:null, marks:{correct:4,incorrect:0} },
    { id:14, section:"Mathematics", type:"multiple", question:"Which are factors of x³ − 6x² + 11x − 6? (Select ALL that apply)", options:["(x−1)","(x−2)","(x−3)","(x−4)"], correct_answer:["A","B","C"], images:null, marks:{correct:4,partial:2,incorrect:-2} },
    { id:15, section:"Mathematics", type:"single",   question:"The area bounded by y = x² and y = x is:", options:["1/6","1/3","1/2","1/4"], correct_answer:["A"], images:null, marks:{correct:4,incorrect:-1} },
  ],
};

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const SESSION_KEY = "jee_sim_session_v2";
const HISTORY_KEY = "jee_sim_history_v2";
const STREAK_KEY  = "jee_sim_streak_v2";

function saveSession(data)  { try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch (_) {} }
function loadSession()      { try { const r = localStorage.getItem(SESSION_KEY); return r ? JSON.parse(r) : null; } catch (_) { return null; } }
function clearSession()     { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} }

function loadHistory()      { try { const r = localStorage.getItem(HISTORY_KEY); return r ? JSON.parse(r) : []; } catch (_) { return []; } }
function saveHistory(h)     { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (_) {} }
function clearHistory()     { try { localStorage.removeItem(HISTORY_KEY); } catch (_) {} }

function loadStreak()       { try { const r = localStorage.getItem(STREAK_KEY); return r ? JSON.parse(r) : { count: 0, lastDate: null, longest: 0 }; } catch (_) { return { count: 0, lastDate: null, longest: 0 }; } }
function saveStreak(s)      { try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch (_) {} }

function updateStreak() {
  const today = new Date().toDateString();
  const s = loadStreak();
  if (s.lastDate === today) return s;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const newCount = s.lastDate === yesterday ? s.count + 1 : 1;
  const updated = { count: newCount, lastDate: today, longest: Math.max(newCount, s.longest || 0) };
  saveStreak(updated);
  return updated;
}

function addToHistory(entry) {
  const h = loadHistory();
  h.unshift({ ...entry, id: Date.now() });
  if (h.length > 50) h.splice(50); // keep last 50
  saveHistory(h);
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  not_visited:     { bg:"#e8e6e0", border:"#b5b2a8", text:"#555" },
  not_answered:    { bg:"#ef4444", border:"#dc2626", text:"#fff" },
  answered:        { bg:"#22c55e", border:"#16a34a", text:"#fff" },
  marked:          { bg:"#a855f7", border:"#9333ea", text:"#fff" },
  answered_marked: { bg:"#3b82f6", border:"#2563eb", text:"#fff" },
};

const SEC_PRESETS = {
  Physics:     { bg:"#eff6ff", accent:"#3b82f6", light:"#dbeafe", text:"#1d4ed8" },
  Chemistry:   { bg:"#f0fdf4", accent:"#22c55e", light:"#dcfce7", text:"#15803d" },
  Mathematics: { bg:"#fdf4ff", accent:"#a855f7", light:"#f3e8ff", text:"#7e22ce" },
};
const DYNAMIC_PALETTES = [
  { bg:"#fff7ed", accent:"#f97316", light:"#fed7aa", text:"#c2410c" },
  { bg:"#f0f9ff", accent:"#0ea5e9", light:"#bae6fd", text:"#0369a1" },
  { bg:"#fdf2f8", accent:"#ec4899", light:"#fbcfe8", text:"#be185d" },
  { bg:"#f7fee7", accent:"#84cc16", light:"#d9f99d", text:"#4d7c0f" },
  { bg:"#fefce8", accent:"#eab308", light:"#fef08a", text:"#854d0e" },
];
const dynamicSectionCache = {};
function getSEC(section) {
  if (SEC_PRESETS[section]) return SEC_PRESETS[section];
  if (!dynamicSectionCache[section]) {
    const idx = Object.keys(dynamicSectionCache).length % DYNAMIC_PALETTES.length;
    dynamicSectionCache[section] = DYNAMIC_PALETTES[idx];
  }
  return dynamicSectionCache[section];
}

const fmt = (s) =>
  `${String(Math.floor(s / 3600)).padStart(2,"0")}:${String(Math.floor((s % 3600) / 60)).padStart(2,"0")}:${String(s % 60).padStart(2,"0")}`;

const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validateExamJSON(data) {
  const errors = [];
  if (!data.exam) { errors.push("Missing top-level 'exam' object"); }
  else {
    if (!data.exam.title) errors.push("Missing exam.title");
    if (!data.exam.duration_minutes || typeof data.exam.duration_minutes !== "number") errors.push("Missing or invalid exam.duration_minutes");
    if (!Array.isArray(data.exam.sections) || data.exam.sections.length === 0) errors.push("Missing or empty exam.sections array");
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) { errors.push("Missing or empty 'questions' array"); }
  else {
    data.questions.forEach((q, i) => {
      const p = `Q[${i}] (id=${q.id ?? "?"})`;
      if (q.id === undefined) errors.push(`${p}: missing 'id'`);
      if (!q.section) errors.push(`${p}: missing 'section'`);
      if (!q.type || !["single","multiple","numerical"].includes(q.type)) errors.push(`${p}: 'type' must be single | multiple | numerical`);
      if (!q.question) errors.push(`${p}: missing 'question' text`);
      if (q.correct_answer === undefined) errors.push(`${p}: missing 'correct_answer'`);
      if (!q.marks || q.marks.correct === undefined) errors.push(`${p}: missing marks.correct`);
      if (q.type !== "numerical" && (!Array.isArray(q.options) || q.options.length === 0)) errors.push(`${p}: non-numerical questions need an 'options' array`);
    });
  }
  return errors;
}

// ─── SCORING ──────────────────────────────────────────────────────────────────
function getSafeMarks(q) {
  const m = q.marks || {};

  // detect multiple-type advanced structure
  const isAdvancedMultiple =
    q.type === "multiple" &&
    ("any_wrong" in m || "partial_1" in m || "partial_2" in m);

  return {
    correct: m.correct ?? (q.type === "single" ? 3 : 4),

    incorrect:
      m.incorrect ??
      m.any_wrong ??
      (q.type === "multiple" ? -2 : -1),

    unattempted: m.unattempted ?? 0,

    getPartial: (count) => {
      // use JSON if exists
      if (m[`partial_${count}`] !== undefined) {
        return m[`partial_${count}`];
      }

      // fallback logic
      if (q.type === "multiple") {
        return count; // simple fallback: 1 mark per correct
      }

      return 0;
    },

    hasAdvancedMultiple: isAdvancedMultiple
  };
}

function getQuestionResult(q, ans) {
  const marks = getSafeMarks(q);

  const has =
    ans !== undefined &&
    (Array.isArray(ans) ? ans.length > 0 : String(ans).trim() !== "");

  if (!has) {
    return { status: "unattempted", marks: marks.unattempted };
  }

  // ================= SINGLE =================
  if (q.type === "single") {
    const given = Array.isArray(ans) ? ans[0] : ans;
    const expected = Array.isArray(q.correct_answer)
      ? q.correct_answer[0]
      : q.correct_answer;

    return given === expected
      ? { status: "correct", marks: marks.correct }
      : { status: "incorrect", marks: marks.incorrect };
  }

  // ================= MULTIPLE =================
  if (q.type === "multiple") {
    const user = new Set(Array.isArray(ans) ? ans : []);
    const correct = new Set(q.correct_answer);

    if (user.size === 0) {
      return { status: "unattempted", marks: marks.unattempted };
    }

    const hasWrong = [...user].some(x => !correct.has(x));

    // ===== ADVANCED JSON STRUCTURE =====
    if (marks.hasAdvancedMultiple) {
      if (hasWrong) {
        return { status: "incorrect", marks: marks.incorrect };
      }

      const correctCount = [...user].filter(x => correct.has(x)).length;

      if (correctCount === correct.size) {
        return { status: "correct", marks: marks.correct };
      }

      return {
        status: "partial",
        marks: marks.getPartial(correctCount)
      };
    }

    // ===== FALLBACK STANDARD JEE =====
    if (hasWrong) {
      return { status: "incorrect", marks: marks.incorrect };
    }

    const correctCount = [...user].filter(x => correct.has(x)).length;

    if (correctCount === correct.size) {
      return { status: "correct", marks: marks.correct };
    }

    return {
      status: "partial",
      marks: correctCount // fallback
    };
  }

  // ================= NUMERICAL =================
  if (q.type === "numerical") {
    const given = String(ans).trim();
    const expected = String(q.correct_answer).trim();

    const validAnswers = expected.split("or").map(x => x.trim());

    return validAnswers.includes(given)
      ? { status: "correct", marks: marks.correct }
      : { status: "incorrect", marks: marks.incorrect ?? 0 };
  }

  return { status: "unattempted", marks: 0 };
}

function calcScore(questions, answers) {
  let score = 0,
    correct = 0,
    incorrect = 0,
    unattempted = 0,
    partial = 0;

  questions.forEach(q => {
    const r = getQuestionResult(q, answers[q.id]);

    score += r.marks;

    if (r.status === "correct") correct++;
    else if (r.status === "incorrect") incorrect++;
    else if (r.status === "partial") partial++;
    else unattempted++;
  });

  return { score, correct, incorrect, unattempted, partial };
}

function getStatus(qid, answers, visited, marked) {
  const ans = answers[qid];
  const has = ans !== undefined && (Array.isArray(ans) ? ans.length > 0 : ans !== "");
  const isMark = marked.includes(qid);
  if (!visited.includes(qid)) return "not_visited";
  if (has && isMark) return "answered_marked";
  if (isMark) return "marked";
  if (has) return "answered";
  return "not_answered";
}

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────────
function OptionImage({ src, alt }) {
  const [err, setErr] = useState(false);
  if (!src || err) return null;
  const isDataUrl = src.startsWith("data:");
  return (
    <div style={{ marginTop:6, borderRadius:6, overflow:"hidden", border:"1px solid #e2e8f0", display:"inline-block", maxWidth:"100%" }}>
      <img src={src} alt={alt || "Option image"} onError={isDataUrl ? undefined : () => setErr(true)}
        style={{ display:"block", maxWidth:"100%", maxHeight:140, objectFit:"contain" }} />
    </div>
  );
}

function VirtualNumpad({ value, onChange }) {
  function press(k) {
    const s = String(value || "");
    if (k === "⌫") { onChange(s.slice(0, -1)); return; }
    if (k === "C") { onChange(""); return; }
    if (k === "." && s.includes(".")) return;
    if (k === "-") { onChange(s.startsWith("-") ? s.slice(1) : "-" + s); return; }
    onChange(s + k);
  }
  return (
    <div style={{ background:"#f1f5f9", borderRadius:10, padding:10, display:"inline-block", marginTop:10 }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,44px)", gap:6 }}>
        {["7","8","9","4","5","6","1","2","3","-","0",".","C","⌫"].map(k => (
          <button key={k} onClick={() => press(k)}
            style={{ height:40, borderRadius:7, border:"1px solid #cbd5e1", background:k==="C"||k==="⌫"?"#fee2e2":"#fff", color:k==="C"||k==="⌫"?"#dc2626":"#1e293b", fontSize:15, fontWeight:600, cursor:"pointer" }}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScratchPad({ visible, onClose }) {
  const [text, setText] = useState("");
  if (!visible) return null;
  return (
    <div style={{ position:"fixed", bottom:78, right:20, width:300, background:"#fffde7", border:"2px solid #f59e0b", borderRadius:12, boxShadow:"0 8px 30px rgba(0,0,0,0.2)", zIndex:500, display:"flex", flexDirection:"column" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"9px 14px", borderBottom:"1px solid #fcd34d" }}>
        <span style={{ fontWeight:700, fontSize:13, color:"#92400e" }}>✏️ Scratch Pad</span>
        <button onClick={onClose} style={{ background:"none", border:"none", fontSize:16, cursor:"pointer", color:"#92400e" }}>✕</button>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} placeholder="Rough work…"
        style={{ flex:1, minHeight:170, padding:12, border:"none", background:"transparent", fontSize:13, resize:"none", outline:"none", fontFamily:"monospace", color:"#333", lineHeight:1.8 }} />
      <div style={{ padding:"5px 12px", display:"flex", justifyContent:"flex-end" }}>
        <button onClick={() => setText("")} style={{ fontSize:11, color:"#b45309", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Clear</button>
      </div>
    </div>
  );
}

function ImageViewer({ images, questionId, imageOverrides, onOverride }) {
  const [lightbox, setLightbox] = useState(null);
  const [urlErrors, setUrlErrors] = useState({});
  const fileRefs = useRef({});
  function handleUpload(idx, e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { onOverride(questionId, idx, ev.target.result); setUrlErrors(er => ({ ...er, [idx]: false })); };
    reader.readAsDataURL(file);
  }
  const resolved = images.map((img, i) => imageOverrides?.[questionId]?.[i] || img.src);
  if (!images.length) return null;
  return (
    <>
      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:20 }}>
        {images.map((img, i) => {
          const finalSrc = resolved[i]; const hasError = urlErrors[i];
          if (!finalSrc || hasError) return (
            <div key={i} style={{ flex:"1 1 180px", minWidth:160, background:"#fef9f0", border:"1.5px dashed #f59e0b", borderRadius:10, padding:"14px 16px", display:"flex", flexDirection:"column", gap:6 }}>
              <span style={{ fontSize:22 }}>🖼️</span>
              <span style={{ fontSize:12, fontWeight:600, color:"#92400e" }}>{img.name} not found</span>
              <button onClick={() => fileRefs.current[i]?.click()} style={{ fontSize:11, padding:"4px 10px", background:"#f59e0b", color:"#fff", border:"none", borderRadius:5, cursor:"pointer", fontWeight:600, alignSelf:"flex-start" }}>📁 Upload replacement</button>
              <input ref={el => (fileRefs.current[i] = el)} type="file" accept="image/*" onChange={e => handleUpload(i, e)} style={{ display:"none" }} />
            </div>
          );
          return (
            <div key={i} style={{ flex:"1 1 180px", minWidth:160, background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:10, overflow:"hidden", display:"flex", flexDirection:"column" }}>
              <div style={{ position:"relative", background:"#f1f5f9", display:"flex", alignItems:"center", justifyContent:"center", minHeight:100, cursor:"zoom-in", padding:8 }} onClick={() => setLightbox(i)}>
                <img src={finalSrc} alt={img.name} onError={img.isDataUrl ? undefined : () => setUrlErrors(er => ({ ...er, [i]: true }))} style={{ maxWidth:"100%", maxHeight:200, objectFit:"contain", display:"block" }} />
                <span style={{ position:"absolute", top:5, right:6, background:"rgba(0,0,0,0.45)", color:"#fff", fontSize:10, padding:"2px 7px", borderRadius:10 }}>🔍</span>
              </div>
              <div style={{ padding:"4px 10px", display:"flex", justifyContent:"flex-end" }}>
                <button onClick={() => fileRefs.current[i]?.click()} style={{ fontSize:10, background:"none", border:"none", color:"#94a3b8", cursor:"pointer", textDecoration:"underline" }}>replace</button>
                <input ref={el => (fileRefs.current[i] = el)} type="file" accept="image/*" onChange={e => handleUpload(i, e)} style={{ display:"none" }} />
              </div>
            </div>
          );
        })}
      </div>
      {lightbox !== null && (
        <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.9)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:1000, cursor:"zoom-out" }}>
          <img src={resolved[lightbox]} alt="Zoomed" style={{ maxWidth:"90vw", maxHeight:"78vh", objectFit:"contain", borderRadius:8, display:"block" }} />
          <p style={{ color:"rgba(255,255,255,0.35)", fontSize:11, marginTop:12 }}>Click anywhere to close</p>
        </div>
      )}
    </>
  );
}

// ─── HISTORY SCREEN ───────────────────────────────────────────────────────────
function HistoryScreen({ onBack, onReviewAttempt }) {
  const history = loadHistory();
  const [selected, setSelected] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Aggregate stats across all attempts
  const totalTests = history.length;
  const avgScore   = totalTests > 0 ? Math.round(history.reduce((a, h) => a + h.score, 0) / totalTests) : 0;
  const best       = totalTests > 0 ? Math.max(...history.map(h => h.score)) : 0;
  const avgAcc     = totalTests > 0 ? Math.round(history.reduce((a, h) => a + (h.accuracy || 0), 0) / totalTests) : 0;
  const streak     = loadStreak();

  // Section-wise aggregated accuracy from history
  const sectionAgg = {};
  history.forEach(h => {
    (h.sectionStats || []).forEach(ss => {
      if (!sectionAgg[ss.section]) sectionAgg[ss.section] = { correct: 0, total: 0, count: 0 };
      sectionAgg[ss.section].correct += ss.correct;
      sectionAgg[ss.section].total   += ss.count;
      sectionAgg[ss.section].count++;
    });
  });

  // Score trend (last 8)
  const trend = [...history].reverse().slice(-8);

  function handleClearHistory() {
    clearHistory();
    window.location.reload();
  }

  function exportHistory() {
    const blob = new Blob([JSON.stringify(loadHistory(), null, 2)], { type:"application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "jee_history.json"; a.click();
  }

  if (selected !== null) {
    const attempt = history[selected];
    return <AttemptReview attempt={attempt} onBack={() => setSelected(null)} />;
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0a0f1e", fontFamily:"'Segoe UI',sans-serif", color:"#e2e8f0" }}>
      {/* Header */}
      <div style={{ background:"linear-gradient(90deg,#0f2447,#1e3a5f)", borderBottom:"1px solid #1e3a5f", padding:"14px 28px", display:"flex", alignItems:"center", gap:16 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", color:"#94a3b8", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontSize:13, fontWeight:600 }}>← Back</button>
        <span style={{ fontWeight:800, fontSize:18, color:"#fff", letterSpacing:-0.5 }}>📊 Test History & Analytics</span>
        <div style={{ flex:1 }} />
        <button onClick={exportHistory} style={{ background:"rgba(34,197,94,0.12)", border:"1px solid #22c55e44", color:"#4ade80", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontSize:12, fontWeight:600 }}>↓ Export JSON</button>
        <button onClick={() => setConfirmClear(true)} style={{ background:"rgba(239,68,68,0.1)", border:"1px solid #ef444444", color:"#f87171", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontSize:12, fontWeight:600 }}>🗑 Clear All</button>
      </div>

      <div style={{ maxWidth:1000, margin:"0 auto", padding:"24px 20px" }}>
        {/* Stats cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:12, marginBottom:24 }}>
          {[
            { label:"Tests Taken", value:totalTests, icon:"📝", color:"#3b82f6" },
            { label:"Best Score", value:best, icon:"🏆", color:"#f59e0b" },
            { label:"Avg Score", value:avgScore, icon:"📈", color:"#22c55e" },
            { label:"Avg Accuracy", value:avgAcc + "%", icon:"🎯", color:"#a855f7" },
            { label:"Current Streak", value:streak.count + " days", icon:"🔥", color:"#f97316" },
            { label:"Longest Streak", value:streak.longest + " days", icon:"⚡", color:"#ec4899" },
          ].map(({ label, value, icon, color }) => (
            <div key={label} style={{ background:"rgba(255,255,255,0.04)", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px", borderTop:`3px solid ${color}` }}>
              <div style={{ fontSize:22, marginBottom:6 }}>{icon}</div>
              <div style={{ fontSize:22, fontWeight:800, color }}>{value}</div>
              <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
          {/* Score trend */}
          <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:12, padding:"18px 20px" }}>
            <h3 style={{ margin:"0 0 16px", fontSize:13, fontWeight:800, color:"#94a3b8", textTransform:"uppercase", letterSpacing:0.5 }}>📈 Score Trend (last 8 tests)</h3>
            {trend.length === 0
              ? <p style={{ color:"#334155", fontSize:13, textAlign:"center", padding:"20px 0" }}>No data yet</p>
              : (
                <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:80 }}>
                  {trend.map((t, i) => {
                    const maxS = Math.max(...trend.map(x => x.totalMarks || 1));
                    const pct  = Math.max(4, Math.round(((t.score + (t.totalMarks||300)) / ((t.totalMarks||300) * 2)) * 100));
                    const isPos = t.score >= 0;
                    return (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                        <div style={{ fontSize:9, color:"#64748b", fontWeight:700 }}>{t.score}</div>
                        <div title={`${fmtDate(t.id)} — ${t.score}`} style={{ width:"100%", height: Math.max(4, Math.round((Math.abs(t.score) / Math.max(1, ...trend.map(x => Math.abs(x.score)))) * 60)), background:isPos?"#22c55e":"#ef4444", borderRadius:"3px 3px 0 0", opacity:0.7 + (i / trend.length) * 0.3 }} />
                        <div style={{ fontSize:8, color:"#475569", textAlign:"center", whiteSpace:"nowrap", overflow:"hidden", maxWidth:32 }}>{new Date(t.id).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>

          {/* Section accuracy */}
          <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:12, padding:"18px 20px" }}>
            <h3 style={{ margin:"0 0 16px", fontSize:13, fontWeight:800, color:"#94a3b8", textTransform:"uppercase", letterSpacing:0.5 }}>🎯 Section Accuracy (all-time)</h3>
            {Object.keys(sectionAgg).length === 0
              ? <p style={{ color:"#334155", fontSize:13, textAlign:"center", padding:"20px 0" }}>No data yet</p>
              : Object.entries(sectionAgg).map(([sec, { correct, total }]) => {
                  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
                  const c = getSEC(sec);
                  return (
                    <div key={sec} style={{ marginBottom:12 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                        <span style={{ color:c.accent, fontWeight:700 }}>{sec}</span>
                        <span style={{ color:pct >= 60 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444", fontWeight:700 }}>{pct}%</span>
                      </div>
                      <div style={{ height:6, background:"#1e293b", borderRadius:3, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${pct}%`, background:pct >= 60 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444", borderRadius:3, transition:"width 0.6s" }} />
                      </div>
                    </div>
                  );
                })
            }
          </div>
        </div>

        {/* Attempt list */}
        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e3a5f", borderRadius:12, overflow:"hidden" }}>
          <div style={{ padding:"14px 20px", borderBottom:"1px solid #1e3a5f", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <h3 style={{ margin:0, fontSize:13, fontWeight:800, color:"#94a3b8", textTransform:"uppercase", letterSpacing:0.5 }}>📋 All Attempts</h3>
            <span style={{ fontSize:11, color:"#475569" }}>{history.length} attempts saved</span>
          </div>
          {history.length === 0
            ? <div style={{ padding:"40px 20px", textAlign:"center", color:"#334155", fontSize:14 }}>No test attempts yet. Take a test to see your history here.</div>
            : history.map((h, i) => {
                const isGood = h.accuracy >= 60;
                const c = getSEC(h.sections?.[0] || "Physics");
                return (
                  <div key={h.id} onClick={() => setSelected(i)} style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 20px", borderBottom:"1px solid #0f172a", cursor:"pointer", transition:"background 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                    onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    <div style={{ width:44, height:44, borderRadius:10, background:isGood?"rgba(34,197,94,0.12)":"rgba(239,68,68,0.1)", border:`2px solid ${isGood?"#22c55e44":"#ef444433"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                      <span style={{ fontSize:13, fontWeight:900, color:isGood?"#4ade80":"#f87171" }}>{h.score}</span>
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ margin:0, fontSize:13, fontWeight:700, color:"#e2e8f0", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{h.examTitle}</p>
                      <p style={{ margin:"2px 0 0", fontSize:11, color:"#475569" }}>
                        {fmtDate(h.id)} · {h.correct}✓ {h.incorrect}✗ {h.unattempted}— · {h.accuracy}% acc · {fmt(h.timeTaken || 0)}
                      </p>
                    </div>
                    <div style={{ display:"flex", gap:8, flexShrink:0 }}>
                      {(h.sectionStats || []).map(ss => {
                        const sc = getSEC(ss.section);
                        const pct = ss.count > 0 ? Math.round((ss.correct / ss.count) * 100) : 0;
                        return (
                          <div key={ss.section} style={{ textAlign:"center" }}>
                            <div style={{ fontSize:10, color:sc.accent, fontWeight:700 }}>{ss.section.slice(0,3)}</div>
                            <div style={{ fontSize:11, fontWeight:800, color:pct>=60?"#4ade80":pct>=40?"#fbbf24":"#f87171" }}>{pct}%</div>
                          </div>
                        );
                      })}
                    </div>
                    <span style={{ color:"#334155", fontSize:16 }}>›</span>
                  </div>
                );
              })
          }
        </div>
      </div>

      {confirmClear && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}>
          <div style={{ background:"#0f172a", border:"1px solid #1e3a5f", borderRadius:14, padding:"28px 32px", maxWidth:380, width:"90%" }}>
            <h3 style={{ margin:"0 0 8px", color:"#f87171", fontSize:17 }}>⚠️ Clear All History?</h3>
            <p style={{ fontSize:13, color:"#94a3b8", margin:"0 0 22px" }}>This will permanently delete all {history.length} test attempt{history.length !== 1 ? "s" : ""} and analytics. This cannot be undone.</p>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirmClear(false)} style={{ flex:1, padding:11, background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>Cancel</button>
              <button onClick={handleClearHistory} style={{ flex:1, padding:11, background:"#dc2626", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>Clear All</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ATTEMPT REVIEW ───────────────────────────────────────────────────────────
function AttemptReview({ attempt, onBack }) {
  const [filterSec, setFilterSec] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const qs = attempt.questions || [];

  const filtered = qs.filter(q => {
    if (filterSec !== "all" && q.section !== filterSec) return false;
    if (filterStatus !== "all" && q.result !== filterStatus) return false;
    return true;
  });

  const sections = [...new Set(qs.map(q => q.section))];

  return (
    <div style={{ minHeight:"100vh", background:"#0a0f1e", fontFamily:"'Segoe UI',sans-serif", color:"#e2e8f0" }}>
      <div style={{ background:"linear-gradient(90deg,#0f2447,#1e3a5f)", borderBottom:"1px solid #1e3a5f", padding:"14px 28px", display:"flex", alignItems:"center", gap:16 }}>
        <button onClick={onBack} style={{ background:"rgba(255,255,255,0.08)", border:"1px solid rgba(255,255,255,0.15)", color:"#94a3b8", borderRadius:8, padding:"7px 14px", cursor:"pointer", fontSize:13, fontWeight:600 }}>← Back to History</button>
        <div>
          <div style={{ fontWeight:800, fontSize:15, color:"#fff" }}>{attempt.examTitle}</div>
          <div style={{ fontSize:11, color:"#475569" }}>{fmtDate(attempt.id)}</div>
        </div>
        <div style={{ flex:1 }} />
        <div style={{ display:"flex", gap:16 }}>
          {[["Score", attempt.score, "#22c55e"], ["Correct", attempt.correct+"✓", "#4ade80"], ["Wrong", attempt.incorrect+"✗", "#f87171"], ["Acc", attempt.accuracy+"%", "#fbbf24"]].map(([l,v,c]) => (
            <div key={l} style={{ textAlign:"center" }}>
              <div style={{ fontSize:16, fontWeight:800, color:c }}>{v}</div>
              <div style={{ fontSize:10, color:"#475569" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth:860, margin:"0 auto", padding:"20px 16px" }}>
        {/* Filters */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
          <div style={{ display:"flex", gap:4 }}>
            {["all",...sections].map(s => (
              <button key={s} onClick={() => setFilterSec(s)}
                style={{ padding:"5px 13px", fontSize:11, fontWeight:700, borderRadius:18, border:"1.5px solid", borderColor:filterSec===s?(getSEC(s).accent||"#3b82f6"):"#1e3a5f", background:filterSec===s?(getSEC(s).accent||"#3b82f6")+"22":"transparent", color:filterSec===s?(getSEC(s).accent||"#3b82f6"):"#64748b", cursor:"pointer" }}>
                {s === "all" ? "All Sections" : s}
              </button>
            ))}
          </div>
          <div style={{ display:"flex", gap:4, marginLeft:8 }}>
            {[["all","All"],["correct","✓ Correct"],["incorrect","✗ Wrong"],["unattempted","– Skipped"]].map(([k,l]) => (
              <button key={k} onClick={() => setFilterStatus(k)}
                style={{ padding:"5px 12px", fontSize:11, fontWeight:700, borderRadius:18, border:"1.5px solid", borderColor:filterStatus===k?"#3b82f6":"#1e3a5f", background:filterStatus===k?"#1e40af":"transparent", color:filterStatus===k?"#fff":"#64748b", cursor:"pointer" }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div style={{ fontSize:12, color:"#475569", marginBottom:12 }}>Showing {filtered.length} of {qs.length} questions</div>

        {filtered.map((q, i) => {
          const statusColors = { correct:"#f0fdf4", incorrect:"#fef2f2", unattempted:"#f9fafb", partial:"#fffbeb" };
          const statusIcons  = { correct:"✅", incorrect:"❌", unattempted:"⬜", partial:"⚠️" };
          const labelToText = label => {
            if (!Array.isArray(q.options)) return label;
            const idx = ["A","B","C","D"].indexOf(label);
            if (idx < 0) return label;
            const opt = q.options[idx];
            const text = optText(opt);
            return text || `[Option ${label}]`;
          };
          const userAns = Array.isArray(q.userAnswer) ? q.userAnswer : (q.userAnswer ? [String(q.userAnswer)] : []);
          const corrAns = Array.isArray(q.correct_answer) ? q.correct_answer : [String(q.correct_answer)];
          return (
            <div key={i} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid #1e293b", borderRadius:10, padding:"14px 18px", marginBottom:8, borderLeft:`3px solid ${q.result==="correct"?"#22c55e":q.result==="incorrect"?"#ef4444":"#475569"}` }}>
              <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{statusIcons[q.result] || "⬜"}</span>
                <div style={{ flex:1 }}>
                  <p style={{ margin:"0 0 6px", fontSize:13, fontWeight:600, color:"#e2e8f0", lineHeight:1.5 }}>
                    <span style={{ background:getSEC(q.section).accent+"22", color:getSEC(q.section).accent, fontSize:10, fontWeight:700, padding:"1px 7px", borderRadius:10, marginRight:8 }}>{q.section}</span>
                    Q{q.id}. {q.question}
                  </p>
                  <div style={{ display:"flex", gap:20, fontSize:12, flexWrap:"wrap" }}>
                    <span style={{ color:"#94a3b8" }}>Your answer: <strong style={{ color:q.result==="correct"?"#4ade80":q.result==="incorrect"?"#f87171":"#64748b" }}>
                      {userAns.length > 0 ? (q.type === "numerical" ? q.userAnswer : userAns.map(labelToText).join(", ")) : "—"}
                    </strong></span>
                    <span style={{ color:"#94a3b8" }}>Correct: <strong style={{ color:"#4ade80" }}>
                      {q.type === "numerical" ? String(q.correct_answer) : corrAns.map(labelToText).join(", ")}
                    </strong></span>
                    <span style={{ color:"#475569" }}>Marks: <strong style={{ color:q.marksObtained > 0 ? "#4ade80" : q.marksObtained < 0 ? "#f87171" : "#64748b" }}>{q.marksObtained > 0 ? "+" : ""}{q.marksObtained}</strong></span>
                    {q.timeSpent > 0 && <span style={{ color:"#475569" }}>⏱ {q.timeSpent}s</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── JSON / ZIP UPLOADER ──────────────────────────────────────────────────────
function JSONUploader({ onLoad, onUseDefault }) {
  const [dragging, setDragging] = useState(false);
  const [error, setError]       = useState("");
  const [fileName, setFileName] = useState("");
  const [loading, setLoading]   = useState(false);
  const jsonRef = useRef(); const zipRef = useRef();

  async function processFile(file) {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "json" && ext !== "zip") { setError("Please upload a .json or .zip file."); return; }
    setFileName(file.name); setError(""); setLoading(true);
    try {
      let data;
      if (ext === "zip") { data = await loadZip(file); }
      else {
        const text = await file.text(); data = JSON.parse(text);
        const errs = validateExamJSON(data);
        if (errs.length) throw new Error("Validation failed:\n• " + errs.join("\n• "));
      }
      onLoad(data, file.name);
    } catch (ex) { setError(ex.message); setFileName(""); }
    finally { setLoading(false); }
  }

  function onDrop(e) { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files[0]); }

  return (
    <div style={{ marginBottom:24 }}>
      <label style={{ fontSize:11, fontWeight:700, color:"#374151", display:"block", marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Load Exam (JSON / ZIP)</label>
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        style={{ border:`2px dashed ${dragging?"#2563eb":"#cbd5e1"}`, borderRadius:10, padding:"22px 16px", textAlign:"center", background:dragging?"#eff6ff":"#f8fafc", transition:"all .15s" }}>
        <div style={{ fontSize:28, marginBottom:8 }}>📁</div>
        {loading ? <p style={{ fontSize:13, color:"#2563eb", margin:0, fontWeight:600 }}>⏳ Loading…</p>
          : fileName ? <p style={{ fontSize:13, color:"#15803d", margin:0, fontWeight:600 }}>✅ {fileName}</p>
          : <p style={{ fontSize:13, color:"#475569", margin:0 }}>Drop a .json or .zip file here</p>}
        <p style={{ fontSize:11, color:"#94a3b8", margin:"4px 0 14px" }}>ZIP must contain <code>questions.json</code> + <code>images/</code> folder</p>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={() => jsonRef.current.click()} disabled={loading} style={{ padding:"7px 18px", background:"#0f766e", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer" }}>📄 Browse JSON</button>
          <button onClick={() => zipRef.current.click()} disabled={loading} style={{ padding:"7px 18px", background:"#7c3aed", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer" }}>📦 Browse ZIP</button>
        </div>
        <input ref={jsonRef} type="file" accept=".json" onChange={e => { processFile(e.target.files[0]); e.target.value=""; }} style={{ display:"none" }} />
        <input ref={zipRef}  type="file" accept=".zip"  onChange={e => { processFile(e.target.files[0]); e.target.value=""; }} style={{ display:"none" }} />
      </div>
      {error && <div style={{ marginTop:8, background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8, padding:"10px 12px", fontSize:12, color:"#b91c1c", whiteSpace:"pre-wrap" }}>⚠️ {error}</div>}
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"14px 0 0" }}>
        <div style={{ flex:1, height:1, background:"#e2e8f0" }} />
        <span style={{ fontSize:11, color:"#94a3b8" }}>or</span>
        <div style={{ flex:1, height:1, background:"#e2e8f0" }} />
      </div>
      <button onClick={onUseDefault} style={{ width:"100%", marginTop:12, padding:"10px 0", background:"#f1f5f9", color:"#334155", border:"1.5px solid #e2e8f0", borderRadius:9, fontSize:13, fontWeight:600, cursor:"pointer" }}>Use built-in demo exam</button>
    </div>
  );
}

// ─── RESUME BANNER ────────────────────────────────────────────────────────────
function ResumeBanner({ session, onResume, onDiscard }) {
  const elapsed = session.examData.exam.duration_minutes * 60 - session.timeLeft;
  const answeredCount = Object.keys(session.answers).filter(k => {
    const v = session.answers[k]; return v !== undefined && (Array.isArray(v) ? v.length > 0 : v !== "");
  }).length;
  return (
    <div style={{ background:"#fffbeb", border:"2px solid #f59e0b", borderRadius:14, padding:"20px 24px", marginBottom:24 }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
        <span style={{ fontSize:28, flexShrink:0 }}>⚡</span>
        <div style={{ flex:1 }}>
          <p style={{ margin:"0 0 4px", fontWeight:800, fontSize:15, color:"#92400e" }}>Interrupted session detected!</p>
          <p style={{ margin:"0 0 10px", fontSize:13, color:"#b45309" }}><strong>{session.examData.exam.title}</strong> — {session.name}</p>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:12, color:"#78350f", marginBottom:12 }}>
            <span>⏱ <strong>{fmt(session.timeLeft)}</strong> remaining</span>
            <span>✅ <strong>{answeredCount}</strong> answered</span>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={onResume} style={{ padding:"8px 20px", background:"#f59e0b", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>▶ Resume</button>
            <button onClick={onDiscard} style={{ padding:"8px 16px", background:"#fff", color:"#92400e", border:"1.5px solid #f59e0b", borderRadius:8, fontSize:13, fontWeight:600, cursor:"pointer" }}>Discard</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onStart, onResume, onShowHistory }) {
  const [name, setName]                 = useState("");
  const [examData, setExamData]         = useState(null);
  const [loadedName, setLoadedName]     = useState("");
  const [jsonLoaded, setJsonLoaded]     = useState(false);
  const [savedSession, setSavedSession] = useState(null);
  const history = loadHistory();
  const streak  = loadStreak();

  useEffect(() => {
    injectJSZip();
    const s = loadSession();
    if (s && s.name && s.examData && s.timeLeft > 0) setSavedSession(s);
  }, []);

  function handleLoad(data, fname) { setExamData(data); setLoadedName(fname); setJsonLoaded(true); }
  function handleUseDefault() { setExamData(DEFAULT_EXAM); setLoadedName("Built-in demo"); setJsonLoaded(true); }
  function handleStart() { if (!name.trim() || !examData) return; onStart(name.trim(), examData); }
  function handleDiscard() { clearSession(); setSavedSession(null); }

  const ready = name.trim() && examData;

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#0a0f1e 0%,#0f2447 60%,#1e3a5f 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:16, fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ width:"100%", maxWidth:520 }}>
        {/* Header card */}
        <div style={{ background:"rgba(255,255,255,0.97)", borderRadius:20, padding:"36px 36px 28px", boxShadow:"0 32px 80px rgba(0,0,0,0.45)" }}>
          <div style={{ textAlign:"center", marginBottom:28 }}>
            <div style={{ width:64, height:64, background:"linear-gradient(135deg,#1e3a5f,#2563eb)", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 14px", fontSize:28 }}>🎯</div>
            <h1 style={{ margin:0, fontSize:24, fontWeight:800, color:"#0f2447" }}>NTA JEE Simulator</h1>
            <p style={{ margin:"5px 0 0", fontSize:13, color:"#64748b" }}>Computer Based Test Platform · Advanced Analytics</p>
          </div>

          {/* Quick stats if history exists */}
          {history.length > 0 && (
            <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:10, padding:"12px 16px", marginBottom:20, display:"flex", gap:16, flexWrap:"wrap" }}>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#15803d" }}>{history.length}</div>
                <div style={{ fontSize:10, color:"#64748b" }}>Tests taken</div>
              </div>
              <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#0369a1" }}>{Math.max(...history.map(h => h.score))}</div>
                <div style={{ fontSize:10, color:"#64748b" }}>Best score</div>
              </div>
              {streak.count > 0 && <div style={{ textAlign:"center" }}>
                <div style={{ fontSize:18, fontWeight:800, color:"#f97316" }}>🔥 {streak.count}</div>
                <div style={{ fontSize:10, color:"#64748b" }}>Day streak</div>
              </div>}
              <button onClick={onShowHistory} style={{ marginLeft:"auto", padding:"6px 14px", background:"linear-gradient(135deg,#0f2447,#1e3a5f)", color:"#fff", border:"none", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer" }}>
                📊 View History →
              </button>
            </div>
          )}

          {savedSession && <ResumeBanner session={savedSession} onResume={() => onResume(savedSession)} onDiscard={handleDiscard} />}

          <JSONUploader onLoad={handleLoad} onUseDefault={handleUseDefault} />

          {jsonLoaded && (
            <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:9, padding:"10px 14px", marginBottom:20, fontSize:13, color:"#15803d" }}>
              ✅ <strong>{examData.exam.title}</strong> — {examData.questions.length} Q · {examData.exam.duration_minutes} min
            </div>
          )}

          <label style={{ fontSize:11, fontWeight:700, color:"#374151", display:"block", marginBottom:6, textTransform:"uppercase", letterSpacing:0.5 }}>Candidate Name</label>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleStart()}
            placeholder="Enter your full name"
            style={{ width:"100%", padding:"11px 14px", border:"1.5px solid #e2e8f0", borderRadius:9, fontSize:15, marginBottom:16, boxSizing:"border-box", outline:"none" }} />

          <button onClick={handleStart} disabled={!ready}
            style={{ width:"100%", padding:15, background:ready?"linear-gradient(135deg,#0f2447,#2563eb)":"#e2e8f0", color:ready?"#fff":"#94a3b8", border:"none", borderRadius:10, fontSize:15, fontWeight:700, cursor:ready?"pointer":"not-allowed" }}>
            Proceed to Instructions →
          </button>

          {history.length === 0 && (
            <button onClick={onShowHistory} style={{ width:"100%", marginTop:10, padding:"10px 0", background:"transparent", color:"#94a3b8", border:"1px solid #e2e8f0", borderRadius:9, fontSize:13, fontWeight:600, cursor:"pointer" }}>
              📊 Test History & Analytics
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── INSTRUCTIONS SCREEN ──────────────────────────────────────────────────────
function InstructionsScreen({ name, examData, onBegin }) {
  const [agreed, setAgreed] = useState(false);
  return (
    <div style={{ minHeight:"100vh", background:"#f1f5f9", fontFamily:"'Segoe UI',sans-serif" }}>
      <div style={{ background:"#0f2447", color:"#fff", padding:"12px 28px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontWeight:800, fontSize:15 }}>NTA JEE Simulator</span>
        <span style={{ fontSize:13 }}>Candidate: <strong>{name}</strong></span>
      </div>
      <div style={{ maxWidth:820, margin:"32px auto", background:"#fff", borderRadius:14, padding:"40px 44px", boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <h2 style={{ margin:"0 0 4px", color:"#0f2447", fontSize:22, fontWeight:800 }}>General Instructions</h2>
        <p style={{ margin:"0 0 24px", color:"#64748b", fontSize:13 }}>{examData.exam.title}</p>
        <div style={{ background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:9, padding:"12px 16px", marginBottom:10, fontSize:13, color:"#9a3412" }}>
          ⚠️ Duration: <strong>{examData.exam.duration_minutes} minutes</strong>. Test auto-submits when timer hits 00:00:00.
        </div>
        <div style={{ background:"#f0fdf4", border:"1px solid #86efac", borderRadius:9, padding:"12px 16px", marginBottom:22, fontSize:13, color:"#15803d" }}>
          💾 <strong>Auto-save enabled.</strong> Your progress is saved every 5 seconds. Results are stored in Test History.
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:26 }}>
          {[
            ["📋", `${examData.exam.sections.length} Sections`, examData.exam.sections.join(" · ")],
            ["✅", "Single Correct", "+4 marks, −1 wrong"],
            ["☑️", "Multi-Correct", "+4 all correct, −2 any wrong"],
            ["🔢", "Numerical", "+4 correct, 0 wrong"],
            ["📊", "Analytics", "Review every attempt in History"],
            ["⏱️", "Auto-submit", "When timer expires"],
          ].map(([e, t, s]) => (
            <div key={t} style={{ background:"#f8fafc", borderRadius:8, padding:"11px 13px", display:"flex", gap:10, alignItems:"flex-start" }}>
              <span style={{ fontSize:18 }}>{e}</span>
              <div>
                <p style={{ margin:0, fontWeight:700, fontSize:13, color:"#1e293b" }}>{t}</p>
                <p style={{ margin:0, fontSize:12, color:"#64748b" }}>{s}</p>
              </div>
            </div>
          ))}
        </div>
        <h3 style={{ marginBottom:12, color:"#0f2447", fontWeight:700, fontSize:14 }}>Question Palette Legend</h3>
        <div style={{ display:"flex", flexWrap:"wrap", gap:12, marginBottom:26 }}>
          {Object.entries(STATUS_COLORS).map(([k, c]) => (
            <div key={k} style={{ display:"flex", alignItems:"center", gap:8 }}>
              <div style={{ width:28, height:28, borderRadius:5, background:c.bg, border:`2px solid ${c.border}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:c.text, fontWeight:700 }}>1</div>
              <span style={{ color:"#475569", fontSize:12 }}>{k.replace(/_/g," ")}</span>
            </div>
          ))}
        </div>
        <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer", marginBottom:22, fontSize:14, color:"#334155" }}>
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} style={{ width:18, height:18, cursor:"pointer" }} />
          I have read and understood all instructions.
        </label>
        <button onClick={() => agreed && onBegin()} disabled={!agreed}
          style={{ width:"100%", padding:15, background:agreed?"linear-gradient(135deg,#0f2447,#2563eb)":"#e2e8f0", color:agreed?"#fff":"#94a3b8", border:"none", borderRadius:10, fontSize:15, fontWeight:700, cursor:agreed?"pointer":"not-allowed" }}>
          👉 I am ready to begin
        </button>
      </div>
    </div>
  );
}

// ─── EXAM SCREEN ──────────────────────────────────────────────────────────────
function ExamScreen({ name, examData, onSubmit, resumeData }) {
  const totalSecs = examData.exam.duration_minutes * 60;
  const [timeLeft, setTimeLeft]     = useState(resumeData?.timeLeft ?? totalSecs);
  const [currentQ, setCurrentQ]     = useState(resumeData?.currentQ ?? examData.questions[0].id);
  const [answers, setAnswers]       = useState(resumeData?.answers ?? {});
  const [visited, setVisited]       = useState(resumeData?.visited ?? [examData.questions[0].id]);
  const [marked, setMarked]         = useState(resumeData?.marked ?? []);
  const [bookmarks, setBookmarks]   = useState(resumeData?.bookmarks ?? []);
  const [showSummary, setShowSummary] = useState(false);
  const [scratchOpen, setScratchOpen] = useState(false);
  const [fontSize, setFontSize]     = useState(15);
  const [useNumpad, setUseNumpad]   = useState(true);
  const [imageOverrides, setImageOverrides] = useState({});
  const [lastSaved, setLastSaved]   = useState(null);
  const [flagged, setFlagged]       = useState(resumeData?.flagged ?? []); // doubt flag

  const questionTimesRef = useRef(resumeData?.questionTimes ?? {});
  const qStartRef    = useRef(Date.now());
  const timerRef     = useRef(); const saveTimerRef = useRef();
  const answersRef   = useRef(answers); const currentQRef = useRef(currentQ);
  const visitedRef   = useRef(visited); const markedRef   = useRef(marked);
  const bookmarksRef = useRef(bookmarks); const timeLeftRef = useRef(timeLeft);
  const flaggedRef   = useRef(flagged);

  answersRef.current   = answers;   currentQRef.current  = currentQ;
  visitedRef.current   = visited;   markedRef.current    = marked;
  bookmarksRef.current = bookmarks; timeLeftRef.current  = timeLeft;
  flaggedRef.current   = flagged;

  const persistSession = useCallback(() => {
    const qid = currentQRef.current;
    const elapsed = Math.round((Date.now() - qStartRef.current) / 1000);
    questionTimesRef.current[qid] = (questionTimesRef.current[qid] || 0) + elapsed;
    qStartRef.current = Date.now();
    saveSession({ name, examData, timeLeft:timeLeftRef.current, currentQ:qid, answers:answersRef.current, visited:visitedRef.current, marked:markedRef.current, bookmarks:bookmarksRef.current, flagged:flaggedRef.current, questionTimes:{...questionTimesRef.current}, savedAt:Date.now() });
    setLastSaved(new Date());
  }, [name, examData]);

  useEffect(() => { saveTimerRef.current = setInterval(persistSession, 5000); return () => clearInterval(saveTimerRef.current); }, [persistSession]);

  function recordTime(qid) {
    const elapsed = Math.round((Date.now() - qStartRef.current) / 1000);
    questionTimesRef.current[qid] = (questionTimesRef.current[qid] || 0) + elapsed;
    qStartRef.current = Date.now();
  }

  function doSubmit() {
    recordTime(currentQRef.current);
    clearInterval(saveTimerRef.current);
    clearSession();
    const finalAnswers = answersRef.current;
    const timeTaken = totalSecs - timeLeftRef.current;

    // Build per-question results for history
    const questionResults = examData.questions.map(q => {
      const ans = finalAnswers[q.id];
      const r = getQuestionResult(q, ans);
      return {
        id: q.id, section: q.section, type: q.type, question: q.question,
        options: q.options, correct_answer: q.correct_answer,
        userAnswer: ans ?? null, result: r.status, marksObtained: r.marks,
        timeSpent: questionTimesRef.current[q.id] || 0,
      };
    });

    const { score, correct, incorrect, unattempted, partial } = calcScore(examData.questions, finalAnswers);
    const totalMarks = examData.questions.length * 4;
    const accuracy   = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;

    const sectionStats = examData.exam.sections.map(sec => {
      const qs = examData.questions.filter(q => q.section === sec);
      const secScore = calcScore(qs, finalAnswers);
      return { section: sec, ...secScore, count: qs.length };
    });

    const historyEntry = {
      name, examTitle: examData.exam.title, sections: examData.exam.sections,
      score, totalMarks, correct, incorrect, unattempted, partial, accuracy, timeTaken,
      sectionStats, questions: questionResults,
    };

    addToHistory(historyEntry);
    updateStreak();

    onSubmit(finalAnswers, examData.questions, { ...questionTimesRef.current }, historyEntry);
  }

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { clearInterval(timerRef.current); doSubmit(); return 0; } return t - 1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  function goTo(id) { recordTime(currentQ); setCurrentQ(id); setVisited(v => v.includes(id) ? v : [...v, id]); }

  const q    = examData.questions.find(x => x.id === currentQ);
  const sc   = getSEC(q.section);
  const qIdx = examData.questions.findIndex(x => x.id === currentQ);
  const imgs = getImages(q);
  const hasOptionImages = Array.isArray(q.options) && q.options.some(opt => optImageSrc(opt) !== null);


function getMarkLabel(q) {
  const m = getSafeMarks(q);

  if (q.type === "single") {
    return `Single (+${m.correct}/${m.incorrect})`;
  }

  if (q.type === "multiple") {
    return `Multi (+${m.correct}/${m.incorrect})`;
  }

  if (q.type === "numerical") {
    return `Numerical (+${m.correct}/${m.incorrect})`;
  }

  return "";
}


  function selectOption(opt) {
    if (q.type === "single") { setAnswers(a => ({ ...a, [currentQ]: [opt] })); }
    else { setAnswers(a => { const p = a[currentQ] || []; return { ...a, [currentQ]: p.includes(opt) ? p.filter(x => x !== opt) : [...p, opt] }; }); }
  }

  const saveAndNext = () => { if (qIdx < examData.questions.length - 1) goTo(examData.questions[qIdx + 1].id); };
  const goPrev      = () => { if (qIdx > 0) goTo(examData.questions[qIdx - 1].id); };
  const markAndNext = () => { setMarked(m => m.includes(currentQ) ? m : [...m, currentQ]); saveAndNext(); };
  const clearResp   = () => setAnswers(a => { const n = { ...a }; delete n[currentQ]; return n; });
  const toggleBm    = () => setBookmarks(b => b.includes(currentQ) ? b.filter(x => x !== currentQ) : [...b, currentQ]);
  const toggleFlag  = () => setFlagged(f => f.includes(currentQ) ? f.filter(x => x !== currentQ) : [...f, currentQ]);
  function handleOverride(qid, idx, dataURL) { setImageOverrides(p => ({ ...p, [qid]: { ...(p[qid]||{}), [idx]: dataURL } })); }

  const timerRed   = timeLeft < 300;
  const timerAmber = timeLeft < 900;
  const timerColor = timerRed ? "#dc2626" : timerAmber ? "#d97706" : "#15803d";
  const timerBg    = timerRed ? "#fef2f2" : timerAmber ? "#fffbeb" : "#f0fdf4";

  const summaryStats = examData.exam.sections.map(s => {
    const qs = examData.questions.filter(x => x.section === s);
    const ans = qs.filter(x => { const a = answers[x.id]; return a !== undefined && (Array.isArray(a) ? a.length > 0 : a !== ""); });
    return { section:s, total:qs.length, answered:ans.length, unattempted:qs.length - ans.length, marked:qs.filter(x => marked.includes(x.id)).length };
  });

  // Live score preview
  const live = calcScore(examData.questions, answers);

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", height:"100vh", background:"#e8edf2", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ background:"#0f2447", color:"#fff", padding:"6px 14px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, gap:8, flexWrap:"wrap" }}>
        <span style={{ fontWeight:800, fontSize:12, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{examData.exam.title}</span>
        <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
          <span style={{ fontSize:10, color:"#94a3b8" }}>{name}</span>
          {/* Live score
          <div style={{ background:"rgba(255,255,255,0.07)", borderRadius:7, padding:"3px 9px", fontSize:11, fontWeight:700, color:live.score >= 0 ? "#4ade80" : "#f87171" }}>
            Score: {live.score > 0 ? "+" : ""}{live.score}
          </div> */}
          <div style={{ display:"flex", alignItems:"center", gap:4, background:"rgba(255,255,255,0.07)", borderRadius:7, padding:"3px 8px" }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"#4ade80", display:"inline-block" }} />
            <span style={{ fontSize:9, color:"#86efac" }}>{lastSaved ? `Saved ${lastSaved.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"})}` : "Auto-save on"}</span>
          </div>
          <div style={{ display:"flex", gap:2, background:"rgba(255,255,255,0.08)", borderRadius:7, padding:"2px 7px" }}>
            <button onClick={() => setFontSize(f => Math.max(12, f-1))} style={{ background:"none", border:"none", color:"#fff", cursor:"pointer", fontSize:12 }}>A−</button>
            <span style={{ color:"#475569", fontSize:11, alignSelf:"center" }}>|</span>
            <button onClick={() => setFontSize(f => Math.min(20, f+1))} style={{ background:"none", border:"none", color:"#fff", cursor:"pointer", fontSize:14, fontWeight:700 }}>A+</button>
          </div>
          <div style={{ background:timerBg, color:timerColor, borderRadius:8, padding:"4px 10px", fontWeight:800, fontSize:14, fontFamily:"monospace", letterSpacing:1.5 }}>
            {timerRed ? "⚠️" : "⏱"} {fmt(timeLeft)}
          </div>
        </div>
      </div>

      <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
        {/* Question area */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Section tabs */}
          <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", display:"flex", padding:"0 12px", flexShrink:0, overflowX:"auto" }}>
            {examData.exam.sections.map(s => {
              const c = getSEC(s); const active = q.section === s;
              return (
                <div key={s} onClick={() => { const f = examData.questions.find(x => x.section === s); if (f) goTo(f.id); }}
                  style={{ padding:"9px 16px", cursor:"pointer", fontWeight:active?700:500, fontSize:13, borderBottom:active?`3px solid ${c.accent}`:"3px solid transparent", color:active?c.text:"#64748b", whiteSpace:"nowrap" }}>
                  {s}
                </div>
              );
            })}
            <div style={{ flex:1 }} />
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 8px", fontSize:11 }}>
              {bookmarks.length > 0 && <span style={{ color:"#f59e0b", fontWeight:600 }}>🔖 {bookmarks.length}</span>}
              {flagged.length > 0 && <span style={{ color:"#ef4444", fontWeight:600 }}>🚩 {flagged.length} flagged</span>}
            </div>
          </div>

          {/* Question body */}
          <div style={{ flex:1, overflowY:"auto", padding:12 }}>
            <div style={{ background:"#fff", borderRadius:10, padding:"18px 20px", boxShadow:"0 2px 8px rgba(0,0,0,0.07)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12, flexWrap:"wrap" }}>
                <span style={{ background:sc.light, color:sc.text, fontSize:10, fontWeight:700, padding:"2px 9px", borderRadius:20 }}>{q.section}</span>
                <span style={{ background:"#f1f5f9", color:"#475569", fontSize:10, fontWeight:600, padding:"2px 9px", borderRadius:20 }}>
                  {getMarkLabel(q)}
                </span>
                <span style={{ background:"#f8fafc", color:"#94a3b8", fontSize:10, padding:"2px 8px", borderRadius:20 }}>Q{qIdx+1}/{examData.questions.length}</span>
                <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
                  <button onClick={toggleFlag} title="Flag for doubt" style={{ background:flagged.includes(currentQ)?"#fef2f2":"none", border:"none", fontSize:16, cursor:"pointer", opacity:flagged.includes(currentQ)?1:0.35, padding:"2px 6px", borderRadius:6 }}>🚩</button>
                  <button onClick={toggleBm} title="Bookmark" style={{ background:"none", border:"none", fontSize:16, cursor:"pointer", opacity:bookmarks.includes(currentQ)?1:0.35 }}>🔖</button>
                </div>
              </div>

              <p style={{ fontSize:fontSize, fontWeight:600, color:"#0f172a", lineHeight:1.75, margin:"0 0 16px" }}>
                Q{qIdx+1}. {q.question}
              </p>

              {imgs.length > 0 && <ImageViewer images={imgs} questionId={q.id} imageOverrides={imageOverrides} onOverride={handleOverride} />}

              {q.type !== "numerical" && q.options && (
                <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
                  {q.type === "multiple" && <p style={{ margin:"0 0 5px", fontSize:11, color:"#64748b", fontStyle:"italic" }}>* One or more options may be correct</p>}
                  <div style={{ display:hasOptionImages?"grid":"flex", gridTemplateColumns:hasOptionImages?"repeat(auto-fill,minmax(240px,1fr))":undefined, flexDirection:hasOptionImages?undefined:"column", gap:7 }}>
                    {q.options.map((opt, i) => {
                      const label = ["A","B","C","D"][i]; if (!label) return null;
                      const cur = answers[currentQ] || [];
                      const sel = Array.isArray(cur) && cur.includes(label);
                      const text = optText(opt); const imgSrc = optImageSrc(opt);
                      return (
                        <div key={label} onClick={() => selectOption(label)}
                          style={{ display:"flex", flexDirection:imgSrc?"column":"row", alignItems:imgSrc?"stretch":"flex-start", gap:imgSrc?7:10, padding:imgSrc?"11px":"9px 13px", border:sel?`2px solid ${sc.accent}`:"1.5px solid #e2e8f0", borderRadius:8, cursor:"pointer", background:sel?sc.bg:"#fafafa", transition:"all .12s", minHeight:imgSrc?140:undefined }}>
                          <div style={{ width:25, height:25, borderRadius:q.type==="multiple"?4:13, border:sel?`2px solid ${sc.accent}`:"1.5px solid #cbd5e1", background:sel?sc.accent:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:11, color:sel?"#fff":"#64748b", flexShrink:0, alignSelf:imgSrc?"flex-start":"center" }}>{label}</div>
                          <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5 }}>
                            {text && <span style={{ fontSize:fontSize-1, color:"#1e293b", lineHeight:1.55 }}>{text}</span>}
                            {imgSrc && <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", background:"#f8fafc", borderRadius:6, overflow:"hidden", border:"1px solid #e2e8f0", minHeight:80 }}><OptionImage src={imgSrc} alt={`Option ${label}`} /></div>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {q.type === "numerical" && (
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                    <input type="number" value={answers[currentQ] || ""} onChange={e => setAnswers(a => ({ ...a, [currentQ]: e.target.value }))}
                      style={{ fontSize:22, fontWeight:700, border:`2px solid ${sc.accent}`, borderRadius:9, padding:"10px 18px", width:170, textAlign:"center", outline:"none", color:"#cfd2d7", fontFamily:"monospace" }} placeholder="____" />
                    <button onClick={() => setUseNumpad(v => !v)} style={{ fontSize:11, padding:"7px 12px", background:useNumpad?"#1e3a5f":"#f1f5f9", color:useNumpad?"#fff":"#475569", border:"none", borderRadius:7, cursor:"pointer", fontWeight:600 }}>
                      {useNumpad ? "Hide Numpad" : "Numpad"}
                    </button>
                  </div>
                  {useNumpad && <VirtualNumpad value={answers[currentQ] || ""} onChange={v => setAnswers(a => ({ ...a, [currentQ]: v }))} />}
                </div>
              )}
            </div>
          </div>

          {/* Action bar */}
          <div style={{ background:"#fff", borderTop:"1px solid #e2e8f0", padding:"8px 12px", display:"flex", gap:6, flexWrap:"wrap", flexShrink:0, alignItems:"center" }}>
            <button onClick={markAndNext} style={{ padding:"7px 12px", background:"#7c3aed", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer" }}>Mark & Next</button>
            <button onClick={clearResp}   style={{ padding:"7px 10px", background:"#fff", color:"#64748b", border:"1.5px solid #e2e8f0", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer" }}>Clear</button>
            <button onClick={goPrev} disabled={qIdx===0} style={{ padding:"7px 10px", background:"#fff", color:qIdx===0?"#cbd5e1":"#334155", border:`1.5px solid ${qIdx===0?"#f1f5f9":"#e2e8f0"}`, borderRadius:7, fontSize:12, fontWeight:600, cursor:qIdx===0?"not-allowed":"pointer" }}>← Prev</button>
            <button onClick={saveAndNext} disabled={qIdx===examData.questions.length-1}
              style={{ padding:"7px 16px", background:qIdx===examData.questions.length-1?"#94a3b8":"#0f2447", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:qIdx===examData.questions.length-1?"not-allowed":"pointer" }}>
              Save & Next →
            </button>
            <div style={{ flex:1 }} />
            <button onClick={persistSession} style={{ padding:"7px 9px", background:"#f0fdf4", color:"#15803d", border:"1.5px solid #86efac", borderRadius:7, fontSize:11, fontWeight:600, cursor:"pointer" }}>💾</button>
            <button onClick={() => setScratchOpen(v => !v)} style={{ padding:"7px 9px", background:"#fffbeb", color:"#92400e", border:"1.5px solid #fcd34d", borderRadius:7, fontSize:11, fontWeight:600, cursor:"pointer" }}>✏️</button>
            <button onClick={() => setShowSummary(true)} style={{ padding:"7px 12px", background:"#dc2626", color:"#fff", border:"none", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer" }}>Submit</button>
          </div>
        </div>

        {/* Palette sidebar */}
        <div style={{ width:195, background:"#fff", borderLeft:"1px solid #e2e8f0", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          <div style={{ padding:"8px 10px", borderBottom:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <p style={{ margin:0, fontSize:9, fontWeight:800, color:"#334155", textTransform:"uppercase", letterSpacing:0.5 }}>Question Palette</p>
            <div style={{ fontSize:9, color:"#94a3b8" }}>
              {Object.values(answers).filter(a => Array.isArray(a) ? a.length > 0 : a !== "").length}/{examData.questions.length} ans
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto" }}>
            {examData.exam.sections.map(sec => {
              const qs = examData.questions.filter(x => x.section === sec);
              const c = getSEC(sec);
              return (
                <div key={sec}>
                  <div style={{ padding:"5px 10px", background:c.bg, borderBottom:"1px solid #f1f5f9" }}>
                    <span style={{ fontSize:8, fontWeight:800, color:c.text, textTransform:"uppercase", letterSpacing:0.5 }}>{sec}</span>
                  </div>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:4, padding:"7px 8px" }}>
                    {qs.map(q2 => {
                      const st = getStatus(q2.id, answers, visited, marked);
                      const col = STATUS_COLORS[st];
                      const isCur = q2.id === currentQ;
                      const isFlag = flagged.includes(q2.id);
                      return (
                        <div key={q2.id} onClick={() => goTo(q2.id)}
                          style={{ width:29, height:29, borderRadius:5, background:col.bg, border:isCur?`2.5px solid #0f2447`:`1.5px solid ${col.border}`, color:col.text, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, cursor:"pointer", boxShadow:isCur?"0 0 0 2px #93c5fd":"none", position:"relative" }}>
                          {q2.id}
                          {isFlag && <span style={{ position:"absolute", top:-4, right:-4, fontSize:7 }}>🚩</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Live score mini */}
          <div style={{ padding:"8px 10px", borderTop:"1px solid #f1f5f9", background:"#f8fafc" }}>
            {/* <div style={{ fontSize:9, color:"#94a3b8", marginBottom:5, fontWeight:700, textTransform:"uppercase" }}>Live Score</div>
            <div style={{ display:"flex", gap:8, fontSize:10 }}>
              <span style={{ color:"#22c55e", fontWeight:700 }}>✓{live.correct}</span>
              <span style={{ color:"#ef4444", fontWeight:700 }}>✗{live.incorrect}</span>
              <span style={{ color:"#94a3b8" }}>—{live.unattempted}</span>
              <span style={{ marginLeft:"auto", fontWeight:800, color:live.score>=0?"#0f2447":"#ef4444" }}>{live.score > 0 ? "+" : ""}{live.score}</span>
            </div> */}
            {Object.entries(STATUS_COLORS).map(([k, c]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:4, marginTop:3 }}>
                <div style={{ width:10, height:10, borderRadius:2, background:c.bg, border:`1.5px solid ${c.border}`, flexShrink:0 }} />
                <span style={{ fontSize:8, color:"#64748b", textTransform:"capitalize" }}>{k.replace(/_/g," ")}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <ScratchPad visible={scratchOpen} onClose={() => setScratchOpen(false)} />

      {/* Submit modal */}
      {showSummary && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200 }}>
          <div style={{ background:"#fff", borderRadius:14, padding:"24px 28px", width:430, boxShadow:"0 24px 60px rgba(0,0,0,0.3)" }}>
            <h3 style={{ margin:"0 0 4px", color:"#0f2447", fontSize:17, fontWeight:800 }}>⚠️ Submit Confirmation</h3>
            <p style={{ fontSize:13, color:"#64748b", margin:"0 0 16px" }}>Review your attempt summary before submitting.</p>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13, marginBottom:14 }}>
              <thead><tr style={{ background:"#f8fafc" }}>
                {["Section","Total","Answered","Marked","Skipped"].map(h => <th key={h} style={{ padding:"6px 8px", textAlign:"left", color:"#475569", fontWeight:700, fontSize:11, borderBottom:"1px solid #e2e8f0" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {summaryStats.map(r => (
                  <tr key={r.section} style={{ borderBottom:"1px solid #f1f5f9" }}>
                    <td style={{ padding:"6px 8px", fontWeight:600, color:getSEC(r.section).text }}>{r.section}</td>
                    <td style={{ padding:"6px 8px", textAlign:"center" }}>{r.total}</td>
                    <td style={{ padding:"6px 8px", textAlign:"center", color:"#16a34a", fontWeight:700 }}>{r.answered}</td>
                    <td style={{ padding:"6px 8px", textAlign:"center", color:"#9333ea" }}>{r.marked}</td>
                    <td style={{ padding:"6px 8px", textAlign:"center", color:"#ef4444", fontWeight:700 }}>{r.unattempted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* <div style={{ background:"#f0fdf4", borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:13, color:"#15803d" }}>
              Current score: <strong>{live.score}</strong> · Accuracy: <strong>{live.correct + live.incorrect > 0 ? Math.round((live.correct/(live.correct+live.incorrect))*100) : 0}%</strong>
            </div> */}
            {flagged.length > 0 && <div style={{ background:"#fef2f2", borderRadius:8, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#dc2626" }}>⚠️ {flagged.length} question{flagged.length>1?"s":""} flagged with doubts</div>}
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setShowSummary(false)} style={{ flex:1, padding:11, background:"#f1f5f9", color:"#334155", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>← Go Back</button>
              <button onClick={() => { clearInterval(timerRef.current); doSubmit(); }} style={{ flex:1, padding:11, background:"#dc2626", color:"#fff", border:"none", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" }}>Submit Now ✓</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── RESULT SCREEN ────────────────────────────────────────────────────────────
function ResultScreen({ name, answers, questions, examData, questionTimes, historyEntry, onRetry, onShowHistory }) {
  const { score, correct, incorrect, unattempted } = calcScore(questions, answers);
  const totalMarks = questions.reduce((sum, q) => {
  const m = q.marks || {};
  return sum + (m.correct ?? 0);
}, 0);
  const accuracy   = correct + incorrect > 0 ? Math.round((correct/(correct+incorrect))*100) : 0;
  const totalTime  = Object.values(questionTimes).reduce((a, b) => a + b, 0);
  const [tab, setTab]             = useState("overview");
  const [filterSec, setFilterSec] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const sectionStats = examData.exam.sections.map(sec => {
    const qs = questions.filter(q => q.section === sec);
    const s = calcScore(qs, answers);
    const timeSpent = qs.reduce((a, q) => a + (questionTimes[q.id] || 0), 0);
    return { section:sec, ...s, total:qs.length*4, count:qs.length, timeSpent };
  });

  // Comparison with history
  const history = loadHistory();
  const prevAttempts = history.filter(h => h.examTitle === examData.exam.title).slice(1); // skip current (index 0)
  const prevBest = prevAttempts.length > 0 ? Math.max(...prevAttempts.map(h => h.score)) : null;
  const prevAvg  = prevAttempts.length > 0 ? Math.round(prevAttempts.reduce((a, h) => a + h.score, 0) / prevAttempts.length) : null;

  const filtered = questions.filter(q => {
    const r = getQuestionResult(q, answers[q.id]);
    if (filterSec !== "all" && q.section !== filterSec) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  });

  const slowest = [...questions].sort((a, b) => (questionTimes[b.id]||0) - (questionTimes[a.id]||0)).slice(0, 3);

  return (
    <div style={{ fontFamily:"'Segoe UI',sans-serif", minHeight:"100vh", background:"#f1f5f9" }}>
      <div style={{ background:"#0f2447", color:"#fff", padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <span style={{ fontWeight:800, fontSize:15 }}>Results — {examData.exam.title}</span>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={onShowHistory} style={{ padding:"7px 14px", background:"rgba(255,255,255,0.1)", color:"#fff", border:"1px solid rgba(255,255,255,0.2)", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }}>📊 Full History</button>
          <span style={{ fontSize:13, alignSelf:"center", color:"#94a3b8" }}>{name}</span>
        </div>
      </div>

      <div style={{ maxWidth:960, margin:"20px auto", padding:"0 14px" }}>
        {/* Score banner */}
        <div style={{ background:"linear-gradient(135deg,#0f2447,#1e40af)", borderRadius:14, padding:"24px 28px", marginBottom:16, color:"#fff", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:16 }}>
          <div>
            <p style={{ margin:0, fontSize:12, color:"#93c5fd" }}>Total Score</p>
            <p style={{ margin:"2px 0 0", fontSize:54, fontWeight:900, lineHeight:1, color:score >= 0 ? "#86efac" : "#fca5a5" }}>{score}</p>
            <p style={{ margin:"3px 0 0", fontSize:13, color:"#94a3b8" }}>out of {totalMarks} marks · {Math.round((score/totalMarks)*100)}% of max</p>
            {prevBest !== null && (
              <p style={{ margin:"4px 0 0", fontSize:12, color:score > prevBest ? "#4ade80" : "#f87171" }}>
                {score > prevBest ? "🎉 New personal best!" : `Personal best: ${prevBest}`}
                {prevAvg !== null && ` · Avg: ${prevAvg}`}
              </p>
            )}
          </div>
          <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
            {[["✅","Correct",correct,"#86efac"],["❌","Incorrect",incorrect,"#fca5a5"],["⬜","Skipped",unattempted,"#94a3b8"],["🎯","Accuracy",accuracy+"%","#fde68a"],["⏱️","Time",fmt(totalTime),"#c4b5fd"]].map(([e,l,v,c]) => (
              <div key={l} style={{ textAlign:"center" }}>
                <p style={{ margin:0, fontSize:20, fontWeight:800, color:c }}>{v}</p>
                <p style={{ margin:"2px 0 0", fontSize:10, color:"#94a3b8" }}>{e} {l}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap" }}>
          {[["overview","📊 Overview"],["analysis","🔍 Analysis"],["review","📝 Review"],["time","⏱ Time Analysis"]].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ padding:"8px 16px", borderRadius:8, border:"1.5px solid", borderColor:tab===k?"#1e40af":"#e2e8f0", background:tab===k?"#1e3a5f":"#fff", color:tab===k?"#fff":"#475569", fontSize:13, fontWeight:700, cursor:"pointer" }}>
              {l}
            </button>
          ))}
        </div>

        {tab === "overview" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:12, marginBottom:14 }}>
              {sectionStats.map(({ section:sec, score:ss, correct:sc, incorrect:si, unattempted:su, total:st, count, timeSpent }) => {
                const c = getSEC(sec);
                const pct = Math.round((sc/count)*100);
                return (
                  <div key={sec} style={{ background:"#fff", borderRadius:10, padding:"16px 18px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", borderTop:`4px solid ${c.accent}` }}>
                    <p style={{ margin:"0 0 6px", fontWeight:800, fontSize:14, color:c.text }}>{sec}</p>
                    <p style={{ margin:"0 0 2px", fontSize:24, fontWeight:800, color:"#0f172a" }}>{ss} <span style={{ fontSize:12, color:"#94a3b8", fontWeight:400 }}>/ {st}</span></p>
                    <div style={{ display:"flex", gap:10, fontSize:11, marginBottom:5 }}>
                      <span style={{ color:"#16a34a", fontWeight:600 }}>✓{sc}</span>
                      <span style={{ color:"#ef4444", fontWeight:600 }}>✗{si}</span>
                      <span style={{ color:"#94a3b8" }}>—{su}</span>
                    </div>
                    <div style={{ height:5, background:"#f1f5f9", borderRadius:3, overflow:"hidden", marginBottom:4 }}>
                      <div style={{ height:"100%", width:`${pct}%`, background:c.accent, borderRadius:3 }} />
                    </div>
                    <div style={{ fontSize:10, color:"#94a3b8" }}>{pct}% accuracy · ⏱ {Math.round(timeSpent/(sc+si)||0)}s avg</div>
                  </div>
                );
              })}
            </div>

            {/* Comparison with previous attempts */}
            {prevAttempts.length > 0 && (
              <div style={{ background:"#fff", borderRadius:10, padding:"16px 20px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)", marginBottom:14 }}>
                <h3 style={{ margin:"0 0 12px", fontSize:14, color:"#0f2447", fontWeight:800 }}>📈 vs Previous Attempts ({prevAttempts.length} found)</h3>
                <div style={{ display:"flex", alignItems:"flex-end", gap:6, height:70 }}>
                  {[...prevAttempts].reverse().slice(-6).map((h, i) => {
                    const all = [...prevAttempts, { score }];
                    const maxAbs = Math.max(1, ...all.map(x => Math.abs(x.score)));
                    const isPos = h.score >= 0;
                    const ht = Math.max(4, Math.round((Math.abs(h.score) / maxAbs) * 55));
                    return (
                      <div key={i} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                        <div style={{ fontSize:9, color:"#94a3b8", fontWeight:700 }}>{h.score}</div>
                        <div style={{ width:"100%", height:ht, background:isPos?"#94a3b8":"#f87171", borderRadius:"3px 3px 0 0", opacity:0.6 }} />
                        <div style={{ fontSize:8, color:"#94a3b8" }}>{new Date(h.id).toLocaleDateString("en-IN",{day:"numeric",month:"short"})}</div>
                      </div>
                    );
                  })}
                  {/* Current */}
                  <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
                    <div style={{ fontSize:9, color:score >= 0 ? "#16a34a" : "#dc2626", fontWeight:800 }}>{score}</div>
                    <div style={{ width:"100%", height:Math.max(4, Math.round((Math.abs(score)/Math.max(1,...prevAttempts.map(h=>Math.abs(h.score)),Math.abs(score)))*55)), background:score>=0?"#22c55e":"#ef4444", borderRadius:"3px 3px 0 0" }} />
                    <div style={{ fontSize:8, color:"#16a34a", fontWeight:700 }}>NOW</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "analysis" && (
          <div style={{ background:"#fff", borderRadius:10, padding:"18px 22px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <h3 style={{ margin:"0 0 16px", fontSize:14, color:"#0f2447", fontWeight:800 }}>Section-wise Breakdown</h3>
            {sectionStats.map(({ section:sec, score:ss, correct:sc, incorrect:si, unattempted:su, total:st, count }) => {
              const c = getSEC(sec);
              return (
                <div key={sec} style={{ marginBottom:18 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                    <span style={{ fontWeight:700, fontSize:14, color:c.text }}>{sec}</span>
                    <span style={{ fontSize:13, color:"#475569" }}>{ss}/{st} ({Math.round((ss/st)*100)}%)</span>
                  </div>
                  <div style={{ height:10, background:"#f1f5f9", borderRadius:5, overflow:"hidden", display:"flex" }}>
                    <div style={{ width:`${Math.round((sc/count)*100)}%`, background:"#22c55e" }} />
                    <div style={{ width:`${Math.round((si/count)*100)}%`, background:"#ef4444" }} />
                    <div style={{ flex:1, background:"#e2e8f0" }} />
                  </div>
                  <div style={{ display:"flex", gap:12, marginTop:3, fontSize:11 }}>
                    <span style={{ color:"#16a34a" }}>✓ {sc}</span>
                    <span style={{ color:"#ef4444" }}>✗ {si}</span>
                    <span style={{ color:"#94a3b8" }}>— {su}</span>
                  </div>
                </div>
              );
            })}
            <div style={{ borderTop:"1px solid #f1f5f9", paddingTop:14 }}>
              <p style={{ fontWeight:700, fontSize:13, color:"#0f2447", margin:"0 0 8px" }}>⚠️ Weak areas (below 50% accuracy)</p>
              {sectionStats.filter(s => s.score/s.total < 0.5).length === 0
                ? <p style={{ fontSize:13, color:"#16a34a", margin:0 }}>🎉 No weak sections! Great performance.</p>
                : sectionStats.filter(s => s.score/s.total < 0.5).map(s => (
                    <div key={s.section} style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px", background:"#fff7ed", borderRadius:7, marginBottom:6 }}>
                      <span style={{ fontSize:16 }}>⚠️</span>
                      <span style={{ fontSize:13, color:"#9a3412" }}><strong>{s.section}</strong> — {Math.round((s.score/s.total)*100)}% scored. Needs more practice.</span>
                    </div>
                  ))
              }
            </div>
          </div>
        )}

        {tab === "review" && (
          <div style={{ background:"#fff", borderRadius:10, padding:"16px 20px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, flexWrap:"wrap", gap:8 }}>
              <h3 style={{ margin:0, fontSize:14, color:"#0f2447", fontWeight:800 }}>Detailed Review</h3>
              <div style={{ display:"flex", gap:4, flexWrap:"wrap" }}>
                {["all",...examData.exam.sections].map(s => {
                  const c = s === "all" ? null : getSEC(s);
                  return <button key={s} onClick={() => setFilterSec(s)} style={{ padding:"4px 12px", fontSize:11, fontWeight:700, borderRadius:16, border:"1.5px solid", borderColor:filterSec===s?(c?c.accent:"#1e3a5f"):"#e2e8f0", background:filterSec===s?(c?c.accent:"#1e3a5f"):"#fff", color:filterSec===s?"#fff":"#475569", cursor:"pointer" }}>{s==="all"?"All":s}</button>;
                })}
                <div style={{ width:1, background:"#e2e8f0", margin:"0 4px" }} />
                {[["all","All"],["correct","✓"],["incorrect","✗"],["unattempted","—"]].map(([k,l]) => (
                  <button key={k} onClick={() => setFilterStatus(k)} style={{ padding:"4px 10px", fontSize:11, fontWeight:700, borderRadius:16, border:"1.5px solid", borderColor:filterStatus===k?"#3b82f6":"#e2e8f0", background:filterStatus===k?"#1e40af":"#fff", color:filterStatus===k?"#fff":"#475569", cursor:"pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize:12, color:"#94a3b8", marginBottom:10 }}>Showing {filtered.length} of {questions.length}</div>
            {filtered.map(q2 => {
              const r = getQuestionResult(q2, answers[q2.id]);
              const icon = { correct:"✅", incorrect:"❌", unattempted:"⬜", partial:"⚠️" }[r.status];
              const bg   = { correct:"#f0fdf4", incorrect:"#fef2f2", unattempted:"#f9fafb", partial:"#fffbeb" }[r.status];
              const t    = questionTimes[q2.id] || 0;
              const ans  = answers[q2.id];
              const has  = ans !== undefined && (Array.isArray(ans) ? ans.length > 0 : ans !== "");
              const labelToText = label => {
                if (!Array.isArray(q2.options)) return label;
                const idx = ["A","B","C","D"].indexOf(label);
                const opt = q2.options[idx];
                const text = optText(opt);
                return text || `[Option ${label}]`;
              };
              const corrAns  = Array.isArray(q2.correct_answer) ? q2.correct_answer : [String(q2.correct_answer)];
              const userAns2 = Array.isArray(ans) ? ans : (ans ? [String(ans)] : []);
              return (
                <div key={q2.id} style={{ background:bg, border:"1px solid #f1f5f9", borderRadius:8, padding:"11px 13px", marginBottom:7, borderLeft:`3px solid ${r.status==="correct"?"#22c55e":r.status==="incorrect"?"#ef4444":"#cbd5e1"}` }}>
                  <div style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                    <span style={{ fontSize:14, flexShrink:0, marginTop:1 }}>{icon}</span>
                    <div style={{ flex:1 }}>
                      <p style={{ margin:"0 0 4px", fontSize:13, fontWeight:600, color:"#0f172a" }}>Q{q2.id}. {q2.question}</p>
                      <div style={{ display:"flex", gap:16, fontSize:12, flexWrap:"wrap" }}>
                        <span style={{ color:"#475569" }}>Your: <strong style={{ color:has?(r.status==="correct"?"#15803d":"#dc2626"):"#94a3b8" }}>
                          {has ? (q2.type==="numerical" ? ans : userAns2.map(labelToText).join(", ")) : "—"}
                        </strong></span>
                        <span style={{ color:"#475569" }}>Correct: <strong style={{ color:"#15803d" }}>
                          {q2.type==="numerical" ? String(q2.correct_answer) : corrAns.map(labelToText).join(", ")}
                        </strong></span>
                        <span style={{ color:r.marks > 0 ? "#15803d" : r.marks < 0 ? "#dc2626" : "#94a3b8", fontWeight:700 }}>{r.marks > 0 ? "+" : ""}{r.marks} marks</span>
                        {t > 0 && <span style={{ color:"#94a3b8" }}>⏱ {t}s</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "time" && (
          <div style={{ background:"#fff", borderRadius:10, padding:"16px 20px", boxShadow:"0 2px 8px rgba(0,0,0,0.06)" }}>
            <h3 style={{ margin:"0 0 14px", fontSize:14, color:"#0f2447", fontWeight:800 }}>⏱ Time Analysis</h3>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginBottom:16 }}>
              {questions.map(q2 => {
                const t = questionTimes[q2.id] || 0;
                const max = Math.max(1, ...questions.map(x => questionTimes[x.id] || 0));
                const heat = Math.round((t/max)*100);
                const r = getQuestionResult(q2, answers[q2.id]);
                const bdr = r.status === "correct" ? "#22c55e" : r.status === "incorrect" ? "#ef4444" : "#cbd5e1";
                const col = heat > 70 ? "#dc2626" : heat > 40 ? "#f59e0b" : "#22c55e";
                return (
                  <div key={q2.id} title={`Q${q2.id}: ${t}s — ${r.status}`}
                    style={{ width:32, height:32, borderRadius:6, background:col, opacity:0.15+(heat/100)*0.85, display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff", border:`2px solid ${bdr}` }}>
                    {q2.id}
                  </div>
                );
              })}
            </div>
            <p style={{ margin:"0 0 16px", fontSize:10, color:"#94a3b8" }}>🟢 fast · 🟡 medium · 🔴 slow &nbsp;|&nbsp; Border: ✅ correct · ❌ wrong · ⬜ skipped</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:14 }}>
              {[["Slowest 3", slowest, "#dc2626"], ...sectionStats.map(s => [s.section, s.timeSpent, getSEC(s.section).accent])].slice(0, 3).map(([label, val, color]) => (
                <div key={label} style={{ background:"#f8fafc", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ fontSize:10, color:"#94a3b8", marginBottom:4 }}>{label}</div>
                  {Array.isArray(val)
                    ? val.map(q2 => <div key={q2.id} style={{ fontSize:11, color:"#334155" }}>Q{q2.id}: {questionTimes[q2.id]||0}s</div>)
                    : <div style={{ fontSize:18, fontWeight:800, color }}>{fmt(val)}</div>
                  }
                </div>
              ))}
            </div>
            <div style={{ background:"#f8fafc", borderRadius:10, padding:"14px 16px" }}>
              <h4 style={{ margin:"0 0 10px", fontSize:13, color:"#0f2447" }}>Question-by-question time</h4>
              <div style={{ display:"flex", flexDirection:"column", gap:4, maxHeight:300, overflowY:"auto" }}>
                {[...questions].sort((a,b) => (questionTimes[b.id]||0)-(questionTimes[a.id]||0)).map(q2 => {
                  const t = questionTimes[q2.id] || 0;
                  const r = getQuestionResult(q2, answers[q2.id]);
                  const max = Math.max(1, ...questions.map(x => questionTimes[x.id] || 0));
                  return (
                    <div key={q2.id} style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <span style={{ fontSize:11, color:"#94a3b8", width:28, flexShrink:0 }}>Q{q2.id}</span>
                      <div style={{ flex:1, height:6, background:"#f1f5f9", borderRadius:3, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.round((t/max)*100)}%`, background:r.status==="correct"?"#22c55e":r.status==="incorrect"?"#ef4444":"#94a3b8", borderRadius:3 }} />
                      </div>
                      <span style={{ fontSize:10, color:"#475569", width:40, flexShrink:0, textAlign:"right" }}>{t}s</span>
                      <span style={{ fontSize:11, flexShrink:0 }}>{r.status==="correct"?"✅":r.status==="incorrect"?"❌":"⬜"}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div style={{ display:"flex", gap:10, justifyContent:"center", marginTop:20, marginBottom:36, flexWrap:"wrap" }}>
          <button onClick={onShowHistory} style={{ padding:"12px 28px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" }}>
            📊 View Full History
          </button>
          <button onClick={onRetry} style={{ padding:"12px 36px", background:"linear-gradient(135deg,#0f2447,#2563eb)", color:"#fff", border:"none", borderRadius:10, fontSize:14, fontWeight:700, cursor:"pointer" }}>
            🔄 Take Another Test
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]             = useState("login");
  const [name, setName]                 = useState("");
  const [examData, setExamData]         = useState(null);
  const [resumeData, setResumeData]     = useState(null);
  const [finalAnswers, setFinalAnswers] = useState({});
  const [finalQuestions, setFinalQuestions] = useState([]);
  const [finalTimes, setFinalTimes]     = useState({});
  const [finalHistoryEntry, setFinalHistoryEntry] = useState(null);

  function handleResume(session) {
    setName(session.name);
    setExamData(session.examData);
    setResumeData({ timeLeft:session.timeLeft, currentQ:session.currentQ, answers:session.answers, visited:session.visited, marked:session.marked, bookmarks:session.bookmarks??[], flagged:session.flagged??[], questionTimes:session.questionTimes??{} });
    setScreen("exam");
  }

  if (screen === "history") return <HistoryScreen onBack={() => setScreen(finalAnswers && Object.keys(finalAnswers).length > 0 ? "result" : "login")} />;

  if (screen === "login")
    return <LoginScreen
      onStart={(n, d) => { setName(n); setExamData(d); setResumeData(null); setScreen("instructions"); }}
      onResume={handleResume}
      onShowHistory={() => setScreen("history")}
    />;

  if (screen === "instructions")
    return <InstructionsScreen name={name} examData={examData} onBegin={() => setScreen("exam")} />;

  if (screen === "exam")
    return <ExamScreen
      name={name} examData={examData} resumeData={resumeData}
      onSubmit={(ans, qs, qt, he) => { setFinalAnswers(ans); setFinalQuestions(qs); setFinalTimes(qt); setFinalHistoryEntry(he); setScreen("result"); }}
    />;

  if (screen === "result")
    return <ResultScreen
      name={name} answers={finalAnswers} questions={finalQuestions} examData={examData}
      questionTimes={finalTimes} historyEntry={finalHistoryEntry}
      onRetry={() => { setFinalAnswers({}); setScreen("login"); }}
      onShowHistory={() => setScreen("history")}
    />;
}