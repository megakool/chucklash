const els = {
  pinInput: document.getElementById("pinInput"),
  hostStage: document.getElementById("hostStage"),
  playerAdmin: document.getElementById("playerAdmin"),
  flowControls: document.getElementById("flowControls"),
  demoControls: document.getElementById("demoControls"),
  autoDemoButton: document.getElementById("autoDemoButton")
};

let state = null;
let autoDemoRunning = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-host-pin": els.pinInput.value,
      ...(options.headers || {})
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

async function refresh() {
  try {
    state = await api("/api/state");
    render();
  } catch (error) {
    els.hostStage.innerHTML = `<div class="panel"><h2>Host PIN needed</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

els.demoControls.querySelectorAll("button[data-demo-action]").forEach((button) => {
  button.addEventListener("click", async () => {
    await api(`/api/host/${button.dataset.demoAction}`, { method: "POST", body: "{}" });
    await refresh();
  });
});

els.autoDemoButton.addEventListener("click", async () => {
  if (autoDemoRunning) return;
  autoDemoRunning = true;
  els.autoDemoButton.disabled = true;
  els.autoDemoButton.textContent = "Running...";
  try {
    await autoRunDemoRound();
  } finally {
    autoDemoRunning = false;
    els.autoDemoButton.disabled = false;
    els.autoDemoButton.textContent = "Auto-Run Round";
    await refresh();
  }
});

async function autoRunDemoRound() {
  await api("/api/host/demo-lobby", { method: "POST", body: "{}" });
  await refresh();
  await wait(1400);
  await api("/api/host/start-game", { method: "POST", body: "{}" });
  await refresh();
  await wait(1800);
  await api("/api/host/demo-answers", { method: "POST", body: "{}" });
  await refresh();
  await wait(1200);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "prompt" }) });
  await refresh();
  await wait(3000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "answers" }) });
  await refresh();
  await wait(3000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "voting" }) });
  await refresh();
  await wait(1600);
  await api("/api/host/demo-votes", { method: "POST", body: "{}" });
  await refresh();
  await wait(1000);
  await api("/api/host/set-phase", { method: "POST", body: JSON.stringify({ phase: "results" }) });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function render() {
  renderControls();
  renderPlayers();
  renderStatus();
}

function renderStatus() {
  if (state.phase === "lobby") {
    els.hostStage.innerHTML = `
      <p class="eyebrow">Lobby</p>
      <h2>Room ${escapeHtml(state.roomCode)}</h2>
      <p><strong>${state.players.length}</strong> player${state.players.length === 1 ? "" : "s"} joined.</p>
      <p class="small-note">Open the main game screen on the TV, assign Chuck, then start the game.</p>
    `;
    return;
  }

  if (!state.prompt || state.phase === "finished") {
    els.hostStage.innerHTML = `<p class="eyebrow">Final</p><h2>Game Over</h2><p class="small-note">Use the results link below if you want the saved JSON.</p>`;
    return;
  }

  if (state.phase === "prompt") {
    els.hostStage.innerHTML = `
      <p class="eyebrow">Main screen reveal</p>
      <h2>Video + prompt are live</h2>
      <p class="small-note">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
    `;
    return;
  }

  if (state.phase === "answering") {
    const needed = answerers().length;
    const answered = state.answers.length;
    els.hostStage.innerHTML = `
      <p class="eyebrow">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
      <h2>Players answering</h2>
      <p>${answered} of ${needed} submitted.</p>
      <p class="small-note">Prompt is visible on player phones. Main screen stays generic.</p>
    `;
    return;
  }

  if (state.phase === "answers") {
    els.hostStage.innerHTML = `
      <p class="eyebrow">Answers</p>
      <h2>Answers are on the main screen</h2>
      <p>${state.answers.length} answer${state.answers.length === 1 ? "" : "s"} shown.</p>
    `;
    return;
  }

  if (state.phase === "voting") {
    els.hostStage.innerHTML = `
      <p class="eyebrow">Voting</p>
      <h2>Players voting</h2>
      <p>${Object.keys(state.voteSummary).reduce((sum, id) => sum + state.voteSummary[id], 0)} total vote${Object.keys(state.voteSummary).length === 1 ? "" : "s"} cast.</p>
    `;
    return;
  }

  if (state.phase === "results") {
    els.hostStage.innerHTML = `
      <p class="eyebrow">Results</p>
      <h2>Results are on the main screen</h2>
      <p class="small-note">Advance when the room is ready.</p>
    `;
    return;
  }

  if (state.phase === "leaderboard") {
    els.hostStage.innerHTML = `<p class="eyebrow">Leaderboard</p><h2>Leaderboard is on the main screen</h2>`;
  }
}

function renderControls() {
  const answered = state.answers.length;
  const needed = answerers().length;
  const allAnswered = needed > 0 && answered >= needed;
  const roundLabel = state.currentPromptIndex + 1 >= state.totalPrompts ? "Finish" : "Next Phone Prompt";
  const controlsByPhase = {
    lobby: [
      { label: "Start Game", action: "start-game", primary: true, disabled: state.players.length === 0 },
      { label: "Reload Prompts", action: "reload-prompts" },
      { label: "Reset", action: "reset-game" }
    ],
    answering: [
      { label: "Reveal Video + Prompt", phase: "prompt", primary: true, disabled: !allAnswered },
      { label: "Reveal Anyway", phase: "prompt" },
      { label: "Reset", action: "reset-game" }
    ],
    prompt: [
      { label: "Show Answers", phase: "answers", primary: true },
      { label: "Back to Answering", phase: "answering" }
    ],
    answers: [
      { label: "Open Voting", phase: "voting", primary: true },
      { label: roundLabel, action: "next-prompt" },
      { label: "Leaderboard", phase: "leaderboard" }
    ],
    voting: [
      { label: "Show Results", phase: "results", primary: true },
      { label: "Show Answers", phase: "answers" }
    ],
    results: [
      { label: roundLabel, action: "next-prompt", primary: true },
      { label: "Leaderboard", phase: "leaderboard" }
    ],
    leaderboard: [
      { label: roundLabel, action: "next-prompt", primary: true },
      { label: "Finish", phase: "finished" }
    ],
    finished: [
      { label: "Reset Game", action: "reset-game", primary: true }
    ]
  };
  const controls = controlsByPhase[state.phase] || controlsByPhase.lobby;
  els.flowControls.innerHTML = controls.map((control) => `
    <button type="button"
      class="${control.primary ? "primary" : ""}"
      ${control.action ? `data-action="${control.action}"` : ""}
      ${control.phase ? `data-phase="${control.phase}"` : ""}
      ${control.disabled ? "disabled" : ""}>
      ${escapeHtml(control.label)}
    </button>
  `).join("");
  els.flowControls.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/host/${button.dataset.action}`, { method: "POST", body: "{}" });
      await refresh();
    });
  });
  els.flowControls.querySelectorAll("button[data-phase]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/host/set-phase", {
        method: "POST",
        body: JSON.stringify({ phase: button.dataset.phase })
      });
      await refresh();
    });
  });
}

function answerers() {
  if (!state.prompt) return [];
  if ((state.prompt.mode || "all") === "duel") {
    return state.players.filter((player) => state.currentDuelPlayerIds.includes(player.id));
  }
  return state.players;
}

function renderPlayers() {
  els.playerAdmin.innerHTML = state.players.map((player) => `
    <div class="player-row">
      <span>${escapeHtml(player.name)}${player.isBachelor ? " *" : ""}</span>
      <span>
        <button type="button" data-bachelor="${player.id}">Bachelor</button>
        <button type="button" data-remove="${player.id}">Remove</button>
      </span>
    </div>
  `).join("");
  els.playerAdmin.querySelectorAll("button[data-bachelor]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/host/set-bachelor", { method: "POST", body: JSON.stringify({ playerId: button.dataset.bachelor }) });
      await refresh();
    });
  });
  els.playerAdmin.querySelectorAll("button[data-remove]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/host/remove-player", { method: "POST", body: JSON.stringify({ playerId: button.dataset.remove }) });
      await refresh();
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

setInterval(refresh, 1200);
refresh();
