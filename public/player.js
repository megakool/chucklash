const els = {
  joinCard: document.getElementById("joinCard"),
  gameCard: document.getElementById("gameCard"),
  joinForm: document.getElementById("joinForm"),
  nameInput: document.getElementById("nameInput"),
  status: document.getElementById("status"),
  answerForm: document.getElementById("answerForm"),
  answerInput: document.getElementById("answerInput"),
  voteForm: document.getElementById("voteForm"),
  voteList: document.getElementById("voteList"),
  roomCode: document.getElementById("roomCode")
};

let playerId = localStorage.getItem("chucklashPlayerId") || "";
let state = null;
let draftVotes = {};
let draftPromptId = "";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

els.joinForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = await api("/api/join", {
    method: "POST",
    body: JSON.stringify({ name: els.nameInput.value, playerId })
  });
  playerId = body.playerId;
  localStorage.setItem("chucklashPlayerId", playerId);
  state = body.state;
  render();
});

els.answerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/answer", {
    method: "POST",
    body: JSON.stringify({ playerId, text: els.answerInput.value })
  });
  await refresh();
});

els.voteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/vote", {
    method: "POST",
    body: JSON.stringify({ playerId, votes: draftVotes })
  });
  await refresh();
});

async function refresh() {
  if (!playerId) return;
  try {
    state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    render();
  } catch (error) {
    console.warn(error);
  }
}

function render() {
  if (!state || !state.me) return;
  els.joinCard.classList.add("hidden");
  els.gameCard.classList.remove("hidden");
  els.roomCode.textContent = `Room ${state.roomCode}`;
  els.answerForm.classList.add("hidden");
  els.voteForm.classList.add("hidden");

  const prompt = state.prompt;
  if (state.phase === "lobby") {
    els.status.innerHTML = `
      <div class="phone-state">
        <p class="eyebrow">Joined as ${escapeHtml(state.me.name)}</p>
        <h2>You're in.</h2>
        <p class="small-note">Keep this tab open. The first prompt will appear here when the host starts.</p>
      </div>
    `;
    return;
  }

  if (!prompt) {
    els.status.innerHTML = `<h2>Game over.</h2>${leaderboardMarkup()}`;
    return;
  }

  const duel = (prompt.mode || "all") === "duel";
  const isDuelAnswerer = state.currentDuelPlayerIds.includes(playerId);

  if (state.phase === "prompt") {
    els.status.innerHTML = `
      <div class="phone-state">
        <p class="eyebrow">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
        <h2>Look up.</h2>
        <p class="small-note">The video and prompt are on the main screen.</p>
      </div>
    `;
    return;
  }

  if (state.phase === "answering") {
    if (duel && !isDuelAnswerer) {
      els.status.innerHTML = `<h2>You're voting this round.</h2><p class="small-note">The two answerers are working now.</p>`;
      return;
    }
    els.status.innerHTML = `
      <div class="round-chip">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</div>
      <p class="eyebrow">Answer this</p>
      <div class="phone-prompt">${escapeHtml(prompt.text)}</div>
    `;
    els.answerInput.value = state.myAnswer || "";
    els.answerForm.classList.remove("hidden");
    return;
  }

  if (state.phase === "voting") {
    els.status.innerHTML = `
      <div class="round-chip">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</div>
      <p class="eyebrow">Vote now</p>
      <div class="phone-prompt">${escapeHtml(prompt.text)}</div>
      <p class="small-note">${duel ? "Pick one answer." : "Spend up to 3 votes. You can stack them."}</p>
    `;
    renderVotes(duel ? 1 : 3);
    els.voteForm.classList.remove("hidden");
    return;
  }

  if (state.phase === "answers") {
    els.status.innerHTML = `
      <div class="phone-state">
        <h2>Answers are up.</h2>
        <p class="small-note">Look at the main screen.</p>
      </div>
    `;
    return;
  }

  if (state.phase === "results" || state.phase === "leaderboard" || state.phase === "finished") {
    els.status.innerHTML = `<h2>${state.phase === "results" ? "Results" : "Leaderboard"}</h2>${leaderboardMarkup()}`;
  }
}

function renderVotes(maxVotes) {
  if (draftPromptId !== state.prompt.id) {
    draftVotes = {};
    draftPromptId = state.prompt.id;
  }
  if (!Object.keys(draftVotes).length && Object.keys(state.myVotes || {}).length) {
    draftVotes = { ...(state.myVotes || {}) };
  }
  const answers = state.answers.filter((answer) => answer.playerId !== playerId);
  els.voteList.innerHTML = answers
    .map((answer) => {
      const selected = draftVotes[answer.playerId] || 0;
      return `
        <article class="vote-card">
          <strong>${escapeHtml(answer.text)}</strong>
          <span class="small-note">${escapeHtml(answer.playerName)}</span>
          <div class="vote-buttons">
            ${Array.from({ length: maxVotes + 1 }, (_, count) => `
              <button type="button" class="${selected === count ? "selected" : ""}" data-vote="${answer.playerId}" data-count="${count}">${count}</button>
            `).join("")}
          </div>
        </article>
      `;
    })
    .join("");
  els.voteList.querySelectorAll("button[data-vote]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.vote;
      const count = Number(button.dataset.count);
      draftVotes[target] = count;
      if (count === 0) delete draftVotes[target];
      const total = Object.values(draftVotes).reduce((sum, value) => sum + Number(value), 0);
      if (total > maxVotes) draftVotes[target] = Math.max(0, count - (total - maxVotes));
      renderVotes(maxVotes);
    });
  });
}

function leaderboardMarkup() {
  const players = [...state.players].sort((a, b) => (state.scores[b.id] || 0) - (state.scores[a.id] || 0));
  return `<div class="leaderboard">${players.map((player) => `
    <div class="score-row">
      <span>${escapeHtml(player.name)}${player.isBachelor ? " - Chuck" : ""}</span>
      <strong>${state.scores[player.id] || 0}</strong>
    </div>
  `).join("")}</div>`;
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

setInterval(refresh, 1400);
refresh();
