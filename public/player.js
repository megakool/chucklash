const els = {
  joinCard:  document.getElementById("joinCard"),
  gameCard:  document.getElementById("gameCard"),
  joinForm:  document.getElementById("joinForm"),
  nameInput: document.getElementById("nameInput"),
  status:    document.getElementById("status"),
  voteForm:  document.getElementById("voteForm"),
  voteList:  document.getElementById("voteList")
};

let playerId = localStorage.getItem("chucklashPlayerId") || "";
let state = null;
let lastUpdatedAt = 0;

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

// ─── Join ─────────────────────────────────────────────────────────────────────

els.joinForm.addEventListener("submit", async event => {
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

// ─── Poll ─────────────────────────────────────────────────────────────────────

async function refresh() {
  if (!playerId) return;
  try {
    const newState = await api(`/api/state?playerId=${encodeURIComponent(playerId)}`);
    if (newState.updatedAt !== lastUpdatedAt) {
      lastUpdatedAt = newState.updatedAt;
      state = newState;
      render();
    }
  } catch (err) {
    console.warn(err);
    if (els.gameCard && !els.gameCard.classList.contains("hidden")) {
      els.status.innerHTML = waiting("Reconnecting…");
    }
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function waiting(message) {
  return `
    <div class="p-screen p-screen--waiting">
      <div class="p-waiting-dots"><span></span><span></span><span></span></div>
      <p class="p-waiting-label">${message}</p>
    </div>`;
}

function render() {
  if (!state || !state.me) return;
  els.joinCard.classList.add("hidden");
  els.gameCard.classList.remove("hidden");
  els.voteForm.classList.add("hidden");

  const prompt = state.prompt;

  // ── Lobby ──
  if (state.phase === "lobby") {
    els.status.innerHTML = `
      <div class="p-screen p-screen--lobby">
        <div class="p-badge">You're In ✓</div>
        <h2 class="p-lobby-name">${escapeHtml(state.me.name)}</h2>
        <p class="p-lobby-note">Keep this tab open. The host will kick things off from the main screen.</p>
        <div class="p-waiting-dots"><span></span><span></span><span></span></div>
      </div>`;
    return;
  }

  // ── Answering — multi-prompt UI ──
  if (state.phase === "answering") {
    const myPrompts = state.myPrompts || [];
    const myAnswers = state.myAnswers || {};

    // Late joiner or no assignments
    if (myPrompts.length === 0) {
      els.status.innerHTML = waiting("Hang tight…");
      return;
    }

    const allSubmitted = myPrompts.every(p => myAnswers[p.id]);
    if (allSubmitted) {
      els.status.innerHTML = waiting("Waiting for everyone else…");
      return;
    }

    els.status.innerHTML = `
      <div class="p-screen p-screen--answering">
        <p class="p-kicker">Round ${state.round} of ${state.totalRounds}</p>
        <div class="p-multi-prompts">
          ${myPrompts.map((p, i) => {
            const submitted = !!myAnswers[p.id];
            return `
              <div class="p-prompt-block${submitted ? " p-prompt-block--done" : ""}" data-prompt-id="${escapeHtml(p.id)}">
                <div class="p-prompt-block__header">
                  <span class="p-prompt-block__num">${submitted ? "✓" : i + 1}</span>
                  <span class="p-prompt-block__label">${submitted ? "Submitted" : `Prompt ${i + 1} of ${myPrompts.length}`}</span>
                </div>
                <p class="p-prompt-block__text">${escapeHtml(p.text)}</p>
                ${submitted
                  ? `<p class="p-prompt-block__submitted">Answer locked in ✓</p>`
                  : `<textarea class="p-prompt-block__textarea" maxlength="240" rows="3"
                       placeholder="Write something they'll remember…"></textarea>
                     <div class="p-prompt-block__actions">
                       <span class="p-char-count">0 / 240</span>
                       <button type="button" class="p-primary-btn p-primary-btn--auto p-prompt-block__submit">Submit</button>
                     </div>`
                }
              </div>`;
          }).join("")}
        </div>
      </div>`;

    // Attach per-prompt listeners
    els.status.querySelectorAll(".p-prompt-block:not(.p-prompt-block--done)").forEach(block => {
      const promptId  = block.dataset.promptId;
      const textarea  = block.querySelector(".p-prompt-block__textarea");
      const charCount = block.querySelector(".p-char-count");
      const btn       = block.querySelector(".p-prompt-block__submit");

      textarea.addEventListener("input", () => {
        charCount.textContent = `${textarea.value.length} / 240`;
      });

      btn.addEventListener("click", async () => {
        const text = textarea.value.trim();
        if (!text) return;
        btn.disabled = true;
        try {
          const res = await api("/api/answer", {
            method: "POST",
            body: JSON.stringify({ playerId, promptId, text })
          });
          state = res.state;
          render();
        } catch (err) {
          console.warn(err);
          btn.disabled = false;
        }
      });
    });

    return;
  }

  // ── Prompt reveal (get ready) ──
  if (state.phase === "prompt") {
    els.status.innerHTML = waiting("Get ready…");
    return;
  }

  // ── No active prompt ──
  if (!prompt) {
    els.status.innerHTML = waiting("Hang tight…");
    return;
  }

  // ── Voting ──
  if (state.phase === "voting") {
    if (state.myVotes && Object.keys(state.myVotes).length > 0) {
      els.status.innerHTML = waiting("Waiting for everyone else…");
      return;
    }

    const voteable = (state.answers || []).filter(a => a.playerId !== playerId);

    if (voteable.length === 0) {
      els.status.innerHTML = `
        <div class="p-screen p-screen--no-vote">
          <h2 class="p-no-vote-heading">Can't vote for<br>yourself, sorry.</h2>
          <p class="p-no-vote-note">Sit tight while everyone votes.</p>
          <div class="p-waiting-dots"><span></span><span></span><span></span></div>
        </div>`;
      return;
    }

    els.status.innerHTML = `
      <div class="p-screen p-screen--voting">
        <p class="p-kicker">Vote now</p>
        <div class="p-prompt-text p-prompt-text--sm">${escapeHtml(prompt.text)}</div>
        <p class="p-vote-instruction">Tap the answer you like best.</p>
      </div>`;
    renderVotes(voteable);
    els.voteForm.classList.remove("hidden");
    return;
  }

  // ── All other phases (answers, results, leaderboard, finished) ──
  els.status.innerHTML = waiting("Hang tight…");
}

function renderVotes(voteable) {
  els.voteList.innerHTML = voteable.map(answer => `
    <article class="p-vote-card" data-vote="${answer.playerId}">
      <div class="p-vote-card__answer">${escapeHtml(answer.text)}</div>
    </article>`).join("");

  els.voteList.querySelectorAll(".p-vote-card").forEach(card => {
    card.addEventListener("click", async () => {
      els.voteList.querySelectorAll(".p-vote-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
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
  return String(value).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

setInterval(refresh, 1400);
refresh();
