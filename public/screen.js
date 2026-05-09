const els = {
  screenStage:     document.getElementById("screenStage"),
  screenMastRight: document.getElementById("screenMastRight")
};

const missingEls = Object.entries(els)
  .filter(([, el]) => !el)
  .map(([name]) => name);
if (missingEls.length) {
  throw new Error(`Missing screen element(s): ${missingEls.join(", ")}`);
}

let state = null;
let lastUpdatedAt = 0;

const answersReveal = { promptId: null, count: 0, timer: null };
const resultsRendered = { promptId: null };
const timerState = { phase: null, startedAt: null, durationMs: null, rafId: null };

// ─── API / polling ────────────────────────────────────────────────────────────

async function api(path) {
  const r = await fetch(path, { headers: { "content-type": "application/json" } });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function refresh() {
  try {
    const newState = await api("/api/state");
    state = newState;
    if (state.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = state.updatedAt;
      render();
    }
  } catch (err) {
    els.screenStage.innerHTML = `<div class="panel"><h2>Screen disconnected</h2><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// ─── Main render ──────────────────────────────────────────────────────────────

function render() {
  if (!state) return;

  document.body.dataset.phase = state.phase;

  // Right masthead — dynamic per phase
  els.screenMastRight.innerHTML = mastRightHtml(state.phase);

  if (state.phase === "lobby")                                   { stopTimer(); renderLobby();       return; }
  if (!state.prompt || state.phase === "finished")               { stopTimer(); renderFinished();    return; }
  if (state.phase === "answering")                               {              renderAnswering();   return; }
  if (state.phase === "prompt")                                  { stopTimer(); renderPrompt();      return; }
  if (state.phase === "answers" || state.phase === "voting")     {              renderAnswersPhase();return; }
  if (state.phase === "results")                                 { stopTimer(); renderResults();     return; }
  if (state.phase === "leaderboard")                             { stopTimer(); renderLeaderboard(); return; }
}

// ─── Masthead right content (dynamic per phase) ───────────────────────────────

function mastRightHtml(phase) {
  switch (phase) {
    case "lobby":
      return `<p class="eyebrow">Tonight, in honor of</p><div class="mast-honoree">Charles "Chuck" Rollins</div>`;
    case "answering":
      return `<p class="eyebrow">Time remaining</p><div id="screenTimer" class="screen-timer mast-timer">3:00</div>`;
    case "voting":
      return `<p class="eyebrow">Vote on your phone</p><div id="screenTimer" class="screen-timer mast-timer">0:30</div>`;
    default:
      return "";
  }
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(phase) {
  const durations = { answering: 3 * 60 * 1000, voting: 30 * 1000 };
  const duration = durations[phase];
  if (!duration) return;

  // Sync to server-recorded start time; skip restart only if already in sync
  const serverStart = state.phaseStartedAt || Date.now();
  if (timerState.phase === phase && timerState.startedAt === serverStart) return;

  stopTimer();
  timerState.phase = phase;
  timerState.startedAt = serverStart;
  timerState.durationMs = duration;

  function tick() {
    const el = document.getElementById("screenTimer");
    if (!el) { timerState.rafId = null; return; }
    const remaining = timerState.durationMs - (Date.now() - timerState.startedAt);
    el.textContent = formatTimer(remaining);
    el.classList.toggle("negative", remaining < 0);
    timerState.rafId = requestAnimationFrame(tick);
  }
  timerState.rafId = requestAnimationFrame(tick);
}

function stopTimer() {
  if (timerState.rafId) cancelAnimationFrame(timerState.rafId);
  timerState.phase = null;
  timerState.rafId = null;
}

function formatTimer(ms) {
  const neg  = ms < 0;
  const abs  = Math.abs(ms);
  const secs = Math.ceil(abs / 1000);
  const m    = Math.floor(secs / 60);
  const s    = secs % 60;
  return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0");
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

function renderLobby() {
  els.screenStage.innerHTML = `
    <div class="screen-lobby">
      <section>
        <h2>An Evening<br>with <em>Chuck.</em></h2>
        <ol class="screen-rules">
          <li><span>1.</span> Each chapter, you'll get a prompt. Write something funnier than your friends.</li>
          <li><span>2.</span> Vote for the best answer. Yours doesn't count, sorry.</li>
          <li><span>3.</span> Chuck's pick is worth double. Aim there.</li>
        </ol>
      </section>
      <section class="lobby-right">
        <div class="section-rule">
          <p class="eyebrow">In the room — ${state.players.length} joined</p>
          <span>names appear as they join ↓</span>
        </div>
        <div class="screen-player-list">${state.players.map((p, i) => `
          <span style="--tilt:${[-1.2, 0.8, -0.4, 1.2, -0.8, 0.4][i % 6]}deg">${escapeHtml(p.name)}${p.isBachelor ? " ★" : ""}</span>
        `).join("")}<span class="waiting-chip">waiting...</span></div>
        <div class="join-block join-block--bottom">
          <div class="qr-box" id="qrCanvas"></div>
          <div>
            <p class="eyebrow">Join from your phone</p>
            <div class="join-url">chuck-lash.party</div>
          </div>
        </div>
      </section>
    </div>
  `;

  const qrEl = document.getElementById("qrCanvas");
  if (qrEl && !qrEl.hasChildNodes()) {
    new QRCode(qrEl, {
      text: window.location.origin,
      width: 136, height: 136,
      colorDark: "#1a1612", colorLight: "#fffaf0",
      correctLevel: QRCode.CorrectLevel.M
    });
  }
}

// ─── Answering ────────────────────────────────────────────────────────────────

function renderAnswering() {
  startTimer("answering");
  const done  = state.roundPlayersDone || 0;
  const total = Math.max(1, state.players.length);
  const percent = Math.min(100, Math.round((done / total) * 100));

  els.screenStage.innerHTML = `
    <div class="screen-submit">
      <section>
        <div class="stamp-row"><span class="stamp">Heads Down</span><span class="stamp alt">Phones out</span></div>
        <h2>Look at<br>your<br><em>phone.</em></h2>
        <p class="screen-lede">The prompt is private for now. Write something clever, short, and just risky enough.</p>
      </section>
      <section class="submit-counter">
        <p class="eyebrow">Players Done</p>
        <div class="answer-count">
          <span class="answer-count-number">${done}</span>
          <span class="answer-count-slash">/</span>
          <span class="answer-count-number">${total}</span>
        </div>
        <p class="answer-count-caption">${done === total ? "everyone is in" : "players have submitted"}</p>
        <div class="dot-grid">${Array.from({ length: total }, (_, i) =>
          `<span class="${i < done ? "filled" : ""}"></span>`
        ).join("")}</div>
        <div class="screen-progress"><span style="width:${percent}%"></span></div>
      </section>
    </div>
  `;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function renderPrompt() {
  const mode = promptDisplayMode(state.prompt);
  if (mode === "text") {
    renderTextPrompt();
    return;
  }

  els.screenStage.innerHTML = `
    <div class="video-state">
      <div class="video-frame">${videoMarkup(state.prompt.videoUrl)}</div>
    </div>
  `;
}

function renderTextPrompt() {
  els.screenStage.innerHTML = `
    <div class="text-prompt-state">
      <h2>${escapeHtml(state.prompt.text)}</h2>
    </div>
  `;
}

// ─── Answers + Voting ─────────────────────────────────────────────────────────

function renderAnswersPhase() {
  const promptId = state.prompt.id;

  if (answersReveal.promptId !== promptId) {
    if (answersReveal.timer) clearTimeout(answersReveal.timer);
    answersReveal.promptId = promptId;
    answersReveal.count = 0;

    if (state.phase === "answers") {
      function revealNext() {
        if (!state || !state.prompt || state.prompt.id !== promptId) return;
        // Cap reveals at 4
        const maxReveal = Math.min(4, state.answers.length);
        if (answersReveal.count < maxReveal) {
          answersReveal.count++;
          drawAnswersGrid();
          if (answersReveal.count < maxReveal) {
            answersReveal.timer = setTimeout(revealNext, 3000);
          }
        }
      }
      answersReveal.timer = setTimeout(revealNext, 800);
    } else {
      answersReveal.count = Math.min(4, state.answers.length);
    }
  }

  if (state.phase === "voting") {
    answersReveal.count = Math.min(4, state.answers.length);
    startTimer("voting");
  }

  drawAnswersGrid();
}

function drawAnswersGrid() {
  if (!state || !state.prompt) return;

  const isVoting   = state.phase === "voting";
  const answers    = state.answers.slice(0, 4); // always cap at 4
  const count      = answersReveal.count;

  els.screenStage.innerHTML = `
    <div class="screen-round">
      <div class="screen-prompt">${escapeHtml(state.prompt.text)}</div>
      <div class="answers-grid screen-answers">
        ${Array.from({ length: 4 }, (_, i) => {
          const answer = answers[i];
          if (!answer || i >= count) {
            return `<div class="answer-placeholder"></div>`;
          }
          // Voting: no dots — just the clean card
          return `
            <div class="card-wrap">
              <div class="answer-card${isVoting ? "" : (i === count - 1 ? " answer-enter" : "")}">
                <p class="card-text">"${escapeHtml(answer.text)}"</p>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

// ─── Results ──────────────────────────────────────────────────────────────────

function renderResults() {
  const latest = state.roundResults[state.roundResults.length - 1];
  if (!latest) return;
  if (resultsRendered.promptId === latest.promptId) return;
  resultsRendered.promptId = latest.promptId;

  const answers = latest.answers.slice(0, 4); // cap at 4

  const maxTotal   = answers.reduce((m, a) => Math.max(m, a.points + (a.bachelorBonus || 0)), 0);
  const maxVotes   = answers.reduce((m, a) => Math.max(m, a.votes), 0);

  // Only ONE bachelor badge: the card with highest bachelorBonus
  const maxBonus = answers.reduce((m, a) => Math.max(m, a.bachelorBonus || 0), 0);
  const bachelorPlayerId = maxBonus > 0
    ? (answers.find(a => (a.bachelorBonus || 0) === maxBonus) || {}).playerId
    : null;

  // Wave animation: all cards' nth vote appear together
  // Wave vi fires at STAGE2_START + vi * WAVE_GAP
  // Cards stagger by CARD_STAGGER within the same wave (nearly simultaneous)
  const STAGE2_START = 200;
  const WAVE_GAP     = 80;
  const CARD_STAGGER = 20;

  const hasCrown = bachelorPlayerId !== null;
  // Crown fires after all regular vote waves
  const CROWN_START = STAGE2_START + maxVotes * WAVE_GAP + 200;
  // Winner border fires after crown (or after last vote wave if no crown)
  const WINNER_DELAY = CROWN_START + (hasCrown ? 700 : 0) + 400;

  els.screenStage.innerHTML = `
    <div class="screen-round">
      <div class="screen-prompt">${escapeHtml(state.prompt.text)}</div>
      <div class="results-grid screen-answers">
        ${answers.map((answer, ai) => {
          const total     = answer.points + (answer.bachelorBonus || 0);
          const isWinner  = total >= maxTotal && maxTotal > 0;
          const showBadge = answer.playerId === bachelorPlayerId;

          // Regular dots — wave vi, card ai
          const regularDots = Array.from({ length: answer.votes }, (_, vi) => {
            const delay = STAGE2_START + vi * WAVE_GAP + ai * CARD_STAGGER;
            return `<span class="result-dot" style="animation-delay:${delay}ms"></span>`;
          }).join("");

          // Crown dots — one wave after all regular votes
          const crownDots = showBadge
            ? `<span class="result-dot crown-dot" style="animation-delay:${CROWN_START}ms">★</span>`
            + `<span class="result-dot crown-dot" style="animation-delay:${CROWN_START + 300}ms">★</span>`
            : "";

          const badge = showBadge
            ? `<div class="bachelor-badge" style="animation-delay:0ms">♛ Bachelor's pick</div>`
            : "";

          return `
            <div class="card-wrap">
              <div class="card-author" style="animation-delay:0ms">${escapeHtml(answer.playerName)}</div>
              <div class="answer-card${isWinner ? " answer-winner" : ""}" style="--winner-delay:${WINNER_DELAY}ms">
                ${badge}
                <p class="card-text">"${escapeHtml(answer.text)}"</p>
                <div class="card-dots">${regularDots}${crownDots}</div>
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

// ─── Leaderboard / Finished ───────────────────────────────────────────────────

function renderLeaderboard() {
  els.screenStage.innerHTML = leaderboardMarkup();
}

function renderFinished() {
  els.screenStage.innerHTML = leaderboardMarkup();
}

function leaderboardMarkup() {
  const players = [...state.players].sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));
  const deltas  = getLastRoundDeltas();
  const top     = players.slice(0, 3);
  const pack    = players.slice(3);

  const topRows = top.map((player, i) => {
    const score = state.scores[player.id] || 0;
    const delta = deltas[player.id];
    return `
      <div class="lb-row lb-row--top">
        <span class="lb-rank lb-rank--big">${i + 1}</span>
        <div class="lb-name-group">
          <span class="lb-name">${escapeHtml(player.name)}${player.isBachelor ? " ★" : ""}</span>
          ${delta > 0 ? `<span class="lb-delta">+${delta} this chapter</span>` : ""}
        </div>
        <span class="lb-score">${score.toLocaleString()}</span>
      </div>`;
  }).join("");

  const packRows = pack.map((player, i) => `
    <div class="lb-row lb-row--pack">
      <span class="lb-rank">${i + 4}.</span>
      <span class="lb-name">${escapeHtml(player.name)}${player.isBachelor ? " ★" : ""}</span>
      <span class="lb-score">${(state.scores[player.id] || 0).toLocaleString()}</span>
    </div>`
  ).join("");

  return `
    <div class="lb-two-col">
      <div class="lb-left">
        <div class="lb-section-label">The Front Runners</div>
        ${topRows}
      </div>
      <div class="lb-right">
        <div class="lb-section-label">The Pack</div>
        ${packRows || `<p class="lb-empty">More players join with each round.</p>`}
      </div>
    </div>
  `;
}

function getLastRoundDeltas() {
  if (!state.roundResults.length) return {};
  const last = state.roundResults[state.roundResults.length - 1];
  const d = {};
  for (const a of last.answers) d[a.playerId] = (a.points || 0) + (a.bachelorBonus || 0);
  return d;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function videoMarkup(url) {
  const embed = embedUrl(url);
  if (embed.type === "iframe") {
    return `<iframe src="${escapeHtml(embed.url)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
  }
  return `<video src="${escapeHtml(embed.url)}" controls autoplay playsinline></video>`;
}

function promptDisplayMode(prompt) {
  if (!prompt) return "text";
  if (prompt.displayMode === "text" || prompt.displayMode === "video") return prompt.displayMode;
  return String(prompt.videoUrl || "").trim() ? "video" : "text";
}

function embedUrl(url) {
  try {
    const p = new URL(url);
    if (p.hostname.includes("youtube.com")) {
      const id = p.searchParams.get("v");
      if (id) return { type: "iframe", url: `https://www.youtube.com/embed/${id}?autoplay=1&rel=0` };
    }
    if (p.hostname === "youtu.be") {
      return { type: "iframe", url: `https://www.youtube.com/embed/${p.pathname.slice(1)}?autoplay=1&rel=0` };
    }
    if (p.hostname.includes("drive.google.com")) {
      const m = url.match(/\/d\/([^/]+)/);
      if (m) return { type: "iframe", url: `https://drive.google.com/file/d/${m[1]}/preview` };
    }
  } catch { return { type: "video", url }; }
  return { type: "video", url };
}

function answererCount() {
  if (!state.prompt) return state.players.length;
  if ((state.prompt.mode || "all") === "duel") return state.currentDuelPlayerIds.length;
  return state.players.length;
}

function totalVotes() {
  return Object.values(state.voteSummary || {}).reduce((s, c) => s + Number(c || 0), 0);
}

function wordsMarkup(text) {
  return escapeHtml(text).split(" ").map((word, i) =>
    `<span style="animation-delay:${i * 0.08}s">${word}</span>`
  ).join(" ");
}


function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":'&#039;' }[c]));
}

setInterval(refresh, 1200);
refresh();
