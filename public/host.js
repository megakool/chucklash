const els = {
  pinInput:              document.getElementById("pinInput"),
  hostStage:             document.getElementById("hostStage"),
  playerAdmin:           document.getElementById("playerAdmin"),
  flowControlsPrimary:   document.getElementById("flowControlsPrimary"),
  flowControlsSecondary: document.getElementById("flowControlsSecondary"),
  hcRoomBadge:           document.getElementById("hcRoomBadge"),
  hcPlayerCount:         document.getElementById("hcPlayerCount"),
  autoDemoButton:        document.getElementById("autoDemoButton")
};

let state = null;
let autoDemoRunning = false;

const savedPin = localStorage.getItem("clHostPin");
if (savedPin) els.pinInput.value = savedPin;
els.pinInput.addEventListener("change", () => localStorage.setItem("clHostPin", els.pinInput.value));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "x-host-pin": els.pinInput.value, ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function refresh() {
  try {
    state = await api("/api/state");
    render();
  } catch (err) {
    els.hostStage.innerHTML = `<div class="hc-error"><strong>Connection error</strong><br>${escapeHtml(err.message)}</div>`;
  }
}

document.querySelectorAll("button[data-demo-action]").forEach(button => {
  button.addEventListener("click", async () => {
    await api(`/api/host/${button.dataset.demoAction}`, { method: "POST", body: "{}" });
    await refresh();
  });
});

els.autoDemoButton.addEventListener("click", async () => {
  if (autoDemoRunning) return;
  autoDemoRunning = true;
  els.autoDemoButton.disabled = true;
  els.autoDemoButton.textContent = "Running…";
  try { await autoRunDemoRound(); }
  finally {
    autoDemoRunning = false;
    els.autoDemoButton.disabled = false;
    els.autoDemoButton.textContent = "Auto-Run Round";
    await refresh();
  }
});

async function autoRunDemoRound() {
  await api("/api/host/demo-lobby",       { method: "POST", body: "{}" }); await refresh(); await wait(1400);
  await api("/api/host/start-game",       { method: "POST", body: "{}" }); await refresh(); await wait(1800);
  await api("/api/host/demo-answers",     { method: "POST", body: "{}" }); await refresh(); await wait(1200);
  await api("/api/host/start-round-reveal",{ method: "POST", body: "{}" }); await refresh(); await wait(3000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "answers" }) }); await refresh(); await wait(3000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "voting" }) }); await refresh(); await wait(1600);
  await api("/api/host/demo-votes",       { method: "POST", body: "{}" }); await refresh(); await wait(1000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "results" }) });
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function render() {
  if (els.hcRoomBadge && state.roomCode) els.hcRoomBadge.textContent = `Room ${state.roomCode}`;
  renderStatus();
  renderControls();
  renderPlayers();
}

function renderStatus() {
  const { phase, players, roundAnswered, roundTotal, round, totalRounds, roundPromptPosition, totalRoundPrompts } = state;

  let dotClass = "active", phaseLabel = phase.toUpperCase(), heading = "", note = "", extraHtml = "";

  const promptPos = roundPromptPosition >= 0
    ? `Prompt ${roundPromptPosition + 1} of ${totalRoundPrompts}`
    : "";
  const roundStr = round > 0 ? `Round ${round} of ${totalRounds}${promptPos ? " — " + promptPos : ""}` : "";

  switch (phase) {
    case "lobby":
      dotClass = players.length >= 3 ? "good" : "active";
      heading  = "Waiting for players";
      note     = players.length === 0 ? "Share the room code to get started." : `${players.length} player${players.length === 1 ? "" : "s"} in the room. Assign Chuck, then start.`;
      break;

    case "answering": {
      const answered = roundAnswered || 0, total = roundTotal || 0;
      const pct = total > 0 ? Math.round(answered / total * 100) : 0;
      dotClass = answered >= total && total > 0 ? "good" : "active";
      heading  = "Players are writing";
      note     = `Round ${round} of ${totalRounds}`;
      extraHtml = `
        <div class="hc-progress">
          <div class="hc-progress-label"><span>Answers in</span><span class="hc-progress-frac">${answered}&thinsp;/&thinsp;${total}</span></div>
          <div class="hc-progress-track"><div class="hc-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
      break;
    }

    case "prompt":    dotClass="good"; heading="Prompt is live";      note=roundStr; break;
    case "answers":   dotClass="good"; heading="Answers on screen";   note=`${state.answers.length} answer${state.answers.length===1?"":"s"} revealed — ${roundStr}`; break;
    case "voting": {
      const tv = Object.values(state.voteSummary).reduce((s,v)=>s+Number(v||0),0);
      dotClass = tv > 0 ? "amber" : "active";
      heading = "Voting is open";
      note = tv > 0 ? `${tv} vote${tv===1?"":"s"} cast — ${roundStr}` : roundStr;
      break;
    }
    case "results":     dotClass="good"; heading="Results on screen";    note=roundStr; break;
    case "leaderboard": dotClass="good"; heading="Leaderboard shown";    note=roundStr; break;
    case "finished":    dotClass="";    heading="Game over";             note="Download results to save the night."; break;
    default: heading = phase;
  }

  els.hostStage.innerHTML = `
    <div class="hc-status">
      <div class="hc-status-phase"><div class="hc-phase-dot ${dotClass}"></div>${escapeHtml(phaseLabel)}</div>
      <div class="hc-status-body">
        <h2 class="hc-status-heading">${escapeHtml(heading)}</h2>
        ${note ? `<p class="hc-status-note">${escapeHtml(note)}</p>` : ""}
      </div>
      ${extraHtml}
    </div>`;
}

function renderControls() {
  const answered  = state.roundAnswered || 0;
  const needed    = state.roundTotal || 0;
  const allIn     = needed > 0 && answered >= needed;
  const isLastPrompt = (state.roundPromptPosition + 1) >= state.totalRoundPrompts;
  const isLastRound  = state.round >= state.totalRounds;
  const nextPromptLabel = isLastPrompt ? "Round Leaderboard" : "Next Prompt";
  const nextRoundLabel  = isLastRound  ? "Final Results"     : `Start Round ${state.round + 1}`;

  const byPhase = {
    lobby: [
      { label: "Start Round 1",    action: "start-game",         primary: true, disabled: state.players.length === 0 },
      { label: "Reload Prompts",   action: "reload-prompts" },
      { label: "Reset",            action: "reset-game" }
    ],
    answering: [
      { label: "Reveal Prompts",   action: "start-round-reveal", primary: true, disabled: !allIn },
      { label: "Reveal Anyway",    action: "start-round-reveal" },
      { label: "Reset",            action: "reset-game" }
    ],
    prompt: [
      { label: "Show Answers",     phase: "answers",             primary: true },
      { label: "← Back",          phase: "answering" }
    ],
    answers: [
      { label: "Open Voting",      phase: "voting",              primary: true },
      { label: nextPromptLabel,    action: "next-prompt" },
      { label: "Leaderboard",      phase: "leaderboard" }
    ],
    voting: [
      { label: "Show Results",     phase: "results",             primary: true },
      { label: "← Show Answers",  phase: "answers" }
    ],
    results: [
      { label: nextPromptLabel,    action: "next-prompt",        primary: true },
      { label: "Leaderboard",      phase: "leaderboard" }
    ],
    leaderboard: [
      { label: nextRoundLabel,     action: "start-next-round",   primary: true },
      { label: "End Game",         phase: "finished" }
    ],
    finished: [
      { label: "Reset Game",       action: "reset-game",         primary: true }
    ]
  };

  const controls  = byPhase[state.phase] || byPhase.lobby;
  const primary   = controls.find(c => c.primary);
  const secondary = controls.filter(c => !c.primary);

  els.flowControlsPrimary.innerHTML = primary ? `
    <button type="button" class="hc-primary-btn"
      ${primary.action ? `data-action="${escapeHtml(primary.action)}"` : ""}
      ${primary.phase  ? `data-phase="${escapeHtml(primary.phase)}"` : ""}
      ${primary.disabled ? "disabled" : ""}>
      <span>${escapeHtml(primary.label)}</span>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 7h10M8 3l4 4-4 4"/></svg>
    </button>` : "";

  els.flowControlsSecondary.innerHTML = secondary.map(c => `
    <button type="button" class="hc-secondary-btn"
      ${c.action ? `data-action="${escapeHtml(c.action)}"` : ""}
      ${c.phase  ? `data-phase="${escapeHtml(c.phase)}"` : ""}
      ${c.disabled ? "disabled" : ""}>
      ${escapeHtml(c.label)}
    </button>`).join("");

  [els.flowControlsPrimary, els.flowControlsSecondary].forEach(container => {
    container.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await api(`/api/host/${btn.dataset.action}`, { method: "POST", body: "{}" });
        await refresh();
      });
    });
    container.querySelectorAll("button[data-phase]").forEach(btn => {
      btn.addEventListener("click", async () => {
        await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: btn.dataset.phase }) });
        await refresh();
      });
    });
  });
}

function renderPlayers() {
  if (els.hcPlayerCount) els.hcPlayerCount.textContent = `${state.players.length} in room`;

  if (state.players.length === 0) {
    els.playerAdmin.innerHTML = `<p class="hc-empty">No players yet. Share the room code to get people in.</p>`;
    return;
  }

  els.playerAdmin.innerHTML = state.players.map(player => `
    <div class="hc-player-row">
      <span class="hc-player-name">${escapeHtml(player.name)}</span>
      ${player.isBachelor ? `<span class="hc-bachelor-tag">★ Bachelor</span>` : ""}
      <div class="hc-player-actions">
        <button type="button" class="hc-player-btn${player.isBachelor ? " is-bachelor" : ""}" data-bachelor="${player.id}">
          ${player.isBachelor ? "★ Set" : "Set ★"}
        </button>
        <button type="button" class="hc-player-btn remove" data-remove="${player.id}">×</button>
      </div>
    </div>`).join("");

  els.playerAdmin.querySelectorAll("button[data-bachelor]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api("/api/host/set-bachelor", { method: "POST", body: JSON.stringify({ playerId: btn.dataset.bachelor }) });
      await refresh();
    });
  });
  els.playerAdmin.querySelectorAll("button[data-remove]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await api("/api/host/remove-player", { method: "POST", body: JSON.stringify({ playerId: btn.dataset.remove }) });
      await refresh();
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

setInterval(refresh, 1200);
refresh();
