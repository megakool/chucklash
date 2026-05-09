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
  charCount: document.getElementById("charCount")
};

let playerId = localStorage.getItem("chucklashPlayerId") || "";
let state = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

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

async function refresh() {
  if (!playerId) return;
  try {
    state = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    render();
  } catch (error) {
    console.warn(error);
  }
}

function waiting(message) {
  return `
    <div class="p-screen p-screen--waiting">
      <div class="p-waiting-dots"><span></span><span></span><span></span></div>
      <p class="p-waiting-label">${message}</p>
    </div>
  `;
}

function render() {
  if (!state || !state.me) return;
  els.joinCard.classList.add("hidden");
  els.gameCard.classList.remove("hidden");
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

  // Any phase with no active prompt — just wait
  if (!prompt) {
    els.status.innerHTML = waiting("Hang tight…");
    return;
  }

  if (state.phase === "prompt") {
    els.status.innerHTML = waiting("Get ready…");
    return;
  }

  if (state.phase === "answering") {
    // Already submitted — show waiting
    if (state.myAnswer) {
      els.status.innerHTML = waiting("Waiting for everyone else…");
      return;
    }
    els.status.innerHTML = `
      <div class="p-screen p-screen--answering">
        <p class="p-kicker">Answer this</p>
        <div class="p-prompt-text">${escapeHtml(prompt.text)}</div>
      </div>
    `;
    els.answerInput.value = "";
    if (els.charCount) els.charCount.textContent = "0 / 240";
    els.answerForm.classList.remove("hidden");
    return;
  }

  if (state.phase === "voting") {
    // Already voted — show waiting
    if (state.myVotes && Object.keys(state.myVotes).length > 0) {
      els.status.innerHTML = waiting("Waiting for everyone else…");
      return;
    }

    const voteable = (state.answers || []).filter((a) => a.playerId !== playerId);

    // Nothing to vote for (e.g. your answer is the only one)
    if (voteable.length === 0) {
      els.status.innerHTML = `
        <div class="p-screen p-screen--no-vote">
          <h2 class="p-no-vote-heading">Can't vote for<br>yourself, sorry.</h2>
          <p class="p-no-vote-note">Sit tight while everyone votes.</p>
          <div class="p-waiting-dots"><span></span><span></span><span></span></div>
        </div>
      `;
      return;
    }

    els.status.innerHTML = `
      <div class="p-screen p-screen--voting">
        <p class="p-kicker">Vote now</p>
        <div class="p-prompt-text p-prompt-text--sm">${escapeHtml(prompt.text)}</div>
        <p class="p-vote-instruction">Tap the answer you like best.</p>
      </div>
    `;
    renderVotes(voteable);
    els.voteForm.classList.remove("hidden");
    return;
  }

  // All other phases (answers, results, leaderboard, finished) — just wait quietly
  els.status.innerHTML = waiting("Hang tight…");
}

function renderVotes(voteable) {
  els.voteList.innerHTML = voteable
    .map((answer) => `
      <article class="p-vote-card" data-vote="${answer.playerId}">
        <div class="p-vote-card__answer">${escapeHtml(answer.text)}</div>
      </article>
    `)
    .join("");

  els.voteList.querySelectorAll(".p-vote-card").forEach((card) => {
    card.addEventListener("click", async () => {
      // Visual feedback
      els.voteList.querySelectorAll(".p-vote-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      // Submit immediately
      try {
        await api("/api/vote", {
          method: "POST",
          body: JSON.stringify({ playerId, votes: { [card.dataset.vote]: 1 } })
        });
        await refresh();
      } catch (err) {
        card.classList.remove("selected");
        console.warn(err);
      }
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

setInterval(refresh, 1400);
refresh();
