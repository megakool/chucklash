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
  roomCode: document.getElementById("roomCode"),
  charCount: document.getElementById("charCount")
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

// Live character counter
els.answerInput.addEventListener("input", () => {
  const len = els.answerInput.value.length;
  if (els.charCount) els.charCount.textContent = `${len} / 240`;
});

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
      <div class="p-screen p-screen--lobby">
        <div class="p-badge">You're In ✓</div>
        <h2 class="p-lobby-name">${escapeHtml(state.me.name)}</h2>
        <p class="p-lobby-note">Keep this tab open. The host will kick things off from the main screen.</p>
        <div class="p-waiting-dots"><span></span><span></span><span></span></div>
      </div>
    `;
    return;
  }

  if (!prompt) {
    els.status.innerHTML = `
      <div class="p-screen p-screen--results">
        <h2 class="p-results-heading">Game over.</h2>
        ${leaderboardMarkup()}
      </div>
    `;
    return;
  }

  const duel = (prompt.mode || "all") === "duel";
  const isDuelAnswerer = state.currentDuelPlayerIds.includes(playerId);

  if (state.phase === "prompt") {
    els.status.innerHTML = `
      <div class="p-screen p-screen--lookup">
        <p class="p-chip">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
        <div class="p-lookup-arrow">↑</div>
        <h2 class="p-lookup-heading">Look up.</h2>
        <p class="p-lookup-note">The video and prompt are on the main screen.</p>
      </div>
    `;
    return;
  }

  if (state.phase === "answering") {
    if (duel && !isDuelAnswerer) {
      els.status.innerHTML = `
        <div class="p-screen p-screen--standby">
          <h2 class="p-standby-heading">You're voting<br>this round.</h2>
          <p class="p-standby-note">The two answerers are working now.</p>
        </div>
      `;
      return;
    }
    els.status.innerHTML = `
      <div class="p-screen p-screen--answering">
        <p class="p-chip">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
        <p class="p-kicker">Answer this</p>
        <div class="p-prompt-text">${escapeHtml(prompt.text)}</div>
      </div>
    `;
    els.answerInput.value = state.myAnswer || "";
    if (els.charCount) els.charCount.textContent = `${els.answerInput.value.length} / 240`;
    els.answerForm.classList.remove("hidden");
    return;
  }

  if (state.phase === "voting") {
    els.status.innerHTML = `
      <div class="p-screen p-screen--voting">
        <p class="p-chip">Round ${state.currentPromptIndex + 1} of ${state.totalPrompts}</p>
        <p class="p-kicker">Vote now</p>
        <div class="p-prompt-text p-prompt-text--sm">${escapeHtml(prompt.text)}</div>
        <p class="p-vote-instruction">${duel ? "Pick one answer." : "Spend up to 3 votes. You can stack them."}</p>
      </div>
    `;
    renderVotes(duel ? 1 : 3);
    els.voteForm.classList.remove("hidden");
    return;
  }

  if (state.phase === "answers") {
    els.status.innerHTML = `
      <div class="p-screen p-screen--reveal">
        <h2 class="p-reveal-heading">Answers<br>are up.</h2>
        <p class="p-reveal-note">Look at the main screen.</p>
      </div>
    `;
    return;
  }

  if (state.phase === "results" || state.phase === "leaderboard" || state.phase === "finished") {
    els.status.innerHTML = `
      <div class="p-screen p-screen--results">
        <h2 class="p-results-heading">${state.phase === "results" ? "Results" : "Leaderboard"}</h2>
        ${leaderboardMarkup()}
      </div>
    `;
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
        <article class="p-vote-card">
          <div class="p-vote-card__answer">${escapeHtml(answer.text)}</div>
          <div class="p-vote-card__bar">
            <span class="p-vote-card__name">${escapeHtml(answer.playerName)}</span>
            <div class="p-vote-btns">
              ${Array.from({ length: maxVotes + 1 }, (_, count) => `
                <button type="button" class="${selected === count ? "selected" : ""}" data-vote="${answer.playerId}" data-count="${count}">${count}</button>
              `).join("")}
            </div>
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
  return `<ol class="p-score-list">${players.map((player, i) => `
    <li class="p-score-row">
      <span class="p-score-rank">${i + 1}</span>
      <span class="p-score-name">${escapeHtml(player.name)}${player.isBachelor ? ' <span class="p-score-chuck">chuck</span>' : ""}</span>
      <strong class="p-score-pts">${state.scores[player.id] || 0}</strong>
    </li>
  `).join("")}</ol>`;
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
