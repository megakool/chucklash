const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST_PIN = process.env.HOST_PIN || "chucklash";
const ROOM_CODE = process.env.ROOM_CODE || "CHUCK";
const DATA_DIR = path.join(__dirname, "data");
const PROMPTS_FILE = path.join(DATA_DIR, "prompts.json");
const RESULTS_FILE = path.join(DATA_DIR, "results.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const state = {
  roomCode: ROOM_CODE,
  phase: "lobby",
  round: 0,              // 0 = not started, 1/2/3 = active round
  totalRounds: 3,
  roundPromptIds: [],    // prompt IDs for the current round
  currentPromptIndex: -1, // index into roundPromptIds (-1 = answering, 0+ = reveal)
  currentDuelPlayerIds: [],
  promptAssignments: {}, // { playerId: [promptId, promptId] }
  players: {},
  prompts: loadPrompts(),
  answers: {},           // { promptId: { playerId: text } }
  votes: {},             // { promptId: { playerId: ballot } }
  scores: {},
  roundResults: [],
  phaseStartedAt: Date.now(),
  updatedAt: Date.now()
};

const DEMO_PLAYERS = [
  "Chuck", "Alex", "Jordan", "Taylor", "Morgan", "Sam",
  "Christopher", "Ben", "Nathaniel", "Mike", "Jake", "Will", "Theo", "Marcus", "Danny"
];

// ─── Data persistence ─────────────────────────────────────────────────────────

function loadPrompts() {
  try {
    return JSON.parse(fs.readFileSync(PROMPTS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveResults() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    RESULTS_FILE,
    JSON.stringify({
      savedAt: new Date().toISOString(),
      roomCode: state.roomCode,
      players: Object.values(state.players),
      scores: state.scores,
      prompts: state.prompts,
      roundResults: state.roundResults
    }, null, 2)
  );
}

function touch() {
  state.updatedAt = Date.now();
}

// ─── Round management ─────────────────────────────────────────────────────────

function getRoundPrompts(roundNumber) {
  const total = state.prompts.length;
  if (total === 0) return [];
  const start = Math.floor((roundNumber - 1) * total / state.totalRounds);
  const end   = Math.floor(roundNumber * total / state.totalRounds);
  return state.prompts.slice(start, end);
}

function assignPromptsToPlayers(roundPrompts) {
  state.promptAssignments = {};
  const players = Object.values(state.players);
  if (players.length === 0 || roundPrompts.length === 0) return;

  const promptIds = roundPrompts.map(p => p.id);
  const slotsPerPlayer = 2;

  // Initialise
  for (const player of players) state.promptAssignments[player.id] = [];
  const load = {};
  for (const id of promptIds) load[id] = 0;

  // Shuffle players for random distribution
  const shuffled = [...players].sort(() => Math.random() - 0.5);

  // Fill each slot greedily (pick least-loaded prompt not yet assigned to this player)
  for (let slot = 0; slot < slotsPerPlayer; slot++) {
    for (const player of shuffled) {
      const assigned = state.promptAssignments[player.id];
      const candidates = promptIds
        .filter(id => !assigned.includes(id))
        .sort((a, b) => load[a] - load[b]);
      if (candidates.length === 0) continue;
      assigned.push(candidates[0]);
      load[candidates[0]]++;
    }
  }
}

function startRound(roundNumber) {
  const roundPrompts = getRoundPrompts(roundNumber);
  if (roundPrompts.length === 0) {
    state.phase = "finished";
    saveResults();
    return;
  }
  state.round = roundNumber;
  state.roundPromptIds = roundPrompts.map(p => p.id);
  state.currentPromptIndex = -1;
  state.currentDuelPlayerIds = [];
  assignPromptsToPlayers(roundPrompts);
  state.phase = "answering";
  state.phaseStartedAt = Date.now();
  touch();
}

function roundAnswerProgress() {
  let total = 0, answered = 0;
  for (const [playerId, promptIds] of Object.entries(state.promptAssignments)) {
    for (const promptId of promptIds) {
      total++;
      if (state.answers[promptId]?.[playerId]) answered++;
    }
  }
  return { answered, total };
}

// ─── Current prompt helpers ───────────────────────────────────────────────────

function currentPrompt() {
  if (state.currentPromptIndex < 0 || state.currentPromptIndex >= state.roundPromptIds.length) return null;
  const id = state.roundPromptIds[state.currentPromptIndex];
  return state.prompts.find(p => p.id === id) || null;
}

function currentAnswers() {
  const prompt = currentPrompt();
  if (!prompt) return [];
  return Object.entries(state.answers[prompt.id] || {}).map(([playerId, text]) => ({
    playerId,
    playerName: state.players[playerId]?.name || "Unknown",
    text
  }));
}

function currentVoteSummary() {
  const prompt = currentPrompt();
  if (!prompt) return {};
  const summary = {};
  for (const ballot of Object.values(state.votes[prompt.id] || {})) {
    for (const [playerId, count] of Object.entries(ballot)) {
      summary[playerId] = (summary[playerId] || 0) + Number(count || 0);
    }
  }
  return summary;
}

// ─── Public state ─────────────────────────────────────────────────────────────

function publicState(playerId) {
  const prompt = currentPrompt();
  const players = Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const answers = currentAnswers();
  const voteSummary = currentVoteSummary();
  const { answered: roundAnswered, total: roundTotal } = roundAnswerProgress();

  const myPromptIds = playerId ? (state.promptAssignments[playerId] || []) : [];
  const myPrompts   = myPromptIds.map(pid => state.prompts.find(p => p.id === pid)).filter(Boolean);
  const myAnswers   = {};
  for (const pid of myPromptIds) myAnswers[pid] = state.answers[pid]?.[playerId] || "";

  const roundPlayersDone = Object.entries(state.promptAssignments).filter(
    ([pid, promptIds]) => promptIds.length > 0 && promptIds.every(promptId => state.answers[promptId]?.[pid])
  ).length;

  return {
    roomCode: state.roomCode,
    phase: state.phase,
    round: state.round,
    totalRounds: state.totalRounds,
    roundPromptIds: state.roundPromptIds,
    roundAnswered,
    roundTotal,
    roundPlayersDone,
    phaseStartedAt: state.phaseStartedAt,
    roundPromptPosition: state.currentPromptIndex,  // -1 during answering, 0+ during reveal
    totalRoundPrompts: state.roundPromptIds.length,
    currentPromptIndex: state.currentPromptIndex,
    totalPrompts: state.prompts.length,
    prompt,
    players,
    scores: state.scores,
    answers: hideAnswerAuthors(answers, playerId),
    voteSummary,
    roundResults: state.roundResults,
    currentDuelPlayerIds: state.currentDuelPlayerIds,
    me: playerId ? state.players[playerId] || null : null,
    myPrompts,
    myAnswers,
    myVotes: playerId && prompt ? state.votes[prompt.id]?.[playerId] || {} : {},
    updatedAt: state.updatedAt
  };
}

function hideAnswerAuthors(answers, playerId) {
  if (["results", "leaderboard", "finished"].includes(state.phase)) return answers;
  return answers.map(answer => ({
    ...answer,
    playerName: answer.playerId === playerId ? "You" : "Anonymous"
  }));
}

// ─── Round results ────────────────────────────────────────────────────────────

function calculateRoundResults() {
  const prompt = currentPrompt();
  if (!prompt) return null;
  if (state.roundResults.find(r => r.promptId === prompt.id)) return;

  const voteSummary = currentVoteSummary();
  const bachelor = Object.values(state.players).find(p => p.isBachelor);
  const bachelorBallot = bachelor ? state.votes[prompt.id]?.[bachelor.id] || {} : {};

  const answers = currentAnswers().map(answer => {
    const votes = voteSummary[answer.playerId] || 0;
    const points = votes * 100;
    const bachelorVotes = Number(bachelorBallot[answer.playerId] || 0);
    const bachelorBonus = bachelorVotes * 100;
    state.scores[answer.playerId] = (state.scores[answer.playerId] || 0) + points + bachelorBonus;
    return { ...answer, votes, points, bachelorBonus, bachelorPick: bachelorVotes > 0 };
  });

  const result = {
    promptId: prompt.id,
    promptText: prompt.text,
    mode: prompt.mode || "all",
    completedAt: new Date().toISOString(),
    answers: answers.sort((a, b) => (b.points + b.bachelorBonus) - (a.points + a.bachelorBonus))
  };
  state.roundResults.push(result);
  saveResults();
  return result;
}

// ─── Answerers (for voting phase) ─────────────────────────────────────────────

function answerers() {
  const prompt = currentPrompt();
  if (!prompt) return Object.values(state.players);
  if ((prompt.mode || "all") === "duel") {
    return Object.values(state.players).filter(p => state.currentDuelPlayerIds.includes(p.id));
  }
  const assigned = Object.entries(state.promptAssignments)
    .filter(([, ids]) => ids.includes(prompt.id))
    .map(([pid]) => pid);
  if (assigned.length === 0) return Object.values(state.players);
  return Object.values(state.players).filter(p => assigned.includes(p.id));
}

function nextDuelPlayers() {
  const players = Object.values(state.players);
  if (players.length < 2) return [];
  const round = Math.max(0, state.currentPromptIndex);
  return [players[round % players.length].id, players[(round + 1) % players.length].id];
}

// ─── Demo helpers ─────────────────────────────────────────────────────────────

function createDemoPlayers() {
  for (const [index, name] of DEMO_PLAYERS.entries()) {
    const id = `demo-${index + 1}`;
    state.players[id] = { id, name, isBachelor: index === 0, joinedAt: Date.now() + index };
    state.scores[id] = state.scores[id] || 0;
  }
}

function demoAnswerFor(name, promptText) {
  const samples = [
    `${name} immediately asks if this is going in the group chat`,
    `${name} blames the itinerary and orders another round`,
    `${name} says Chuck has never looked more legally responsible`,
    `${name} starts a toast that somehow becomes a confession`,
    `${name} claims this was all approved by the wedding planner`,
    `${name} simply whispers, "we should not tell anyone"`
  ];
  const seed = (promptText.length + name.length) % samples.length;
  return samples[seed].slice(0, 240);
}

function fillDemoAnswers() {
  // Fill answers for all prompt assignments in the current round
  for (const [playerId, promptIds] of Object.entries(state.promptAssignments)) {
    const player = state.players[playerId];
    if (!player) continue;
    for (const promptId of promptIds) {
      const prompt = state.prompts.find(p => p.id === promptId);
      if (!prompt) continue;
      state.answers[promptId] = state.answers[promptId] || {};
      state.answers[promptId][playerId] = demoAnswerFor(player.name, prompt.text);
    }
  }
}

function fillDemoVotes() {
  const prompt = currentPrompt();
  if (!prompt) return;
  const answerIds = Object.keys(state.answers[prompt.id] || {});
  if (answerIds.length < 2) return;
  const maxVotes = (prompt.mode || "all") === "duel" ? 1 : 3;
  state.votes[prompt.id] = {};
  for (const player of Object.values(state.players)) {
    const targets = answerIds.filter(id => id !== player.id);
    if (!targets.length) continue;
    if (maxVotes === 1) {
      state.votes[prompt.id][player.id] = { [targets[0]]: 1 };
    } else {
      state.votes[prompt.id][player.id] = {
        [targets[0]]: 2,
        [targets[1 % targets.length]]: 1
      };
    }
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 1_000_000) { req.destroy(); reject(new Error("Request too large")); } });
    req.on("end", () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
  });
}

function requireHost(req, res) {
  if (req.headers["x-host-pin"] !== HOST_PIN) { sendJson(res, 401, { error: "Invalid host PIN" }); return false; }
  return true;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, route));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end("Forbidden"); return; }
  const tryHtml = !path.extname(filePath) ? filePath + ".html" : null;
  fs.readFile(filePath, (err, content) => {
    if (err && tryHtml) {
      fs.readFile(tryHtml, (err2, content2) => {
        if (err2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(content2);
      });
      return;
    }
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json" };
    res.writeHead(200, { "content-type": types[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // State
    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, publicState(url.searchParams.get("playerId")));
    }

    // Prompts
    if (req.method === "GET" && url.pathname === "/api/prompts") {
      return sendJson(res, 200, state.prompts);
    }

    // Results
    if (req.method === "GET" && url.pathname === "/api/results") {
      return sendJson(res, 200, fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")) : {});
    }

    // Join
    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await parseBody(req);
      const name = String(body.name || "").trim().slice(0, 32);
      if (!name) return sendJson(res, 400, { error: "Name is required" });
      const id = body.playerId && state.players[body.playerId] ? body.playerId : crypto.randomUUID();
      state.players[id] = state.players[id] || { id, name, isBachelor: false, joinedAt: Date.now() };
      state.players[id].name = name;
      state.scores[id] = state.scores[id] || 0;
      touch();
      return sendJson(res, 200, { playerId: id, state: publicState(id) });
    }

    // Answer — player submits answer for a specific assigned prompt
    if (req.method === "POST" && url.pathname === "/api/answer") {
      const body = await parseBody(req);
      const player = state.players[body.playerId];
      const promptId = String(body.promptId || "").trim();
      const prompt = state.prompts.find(p => p.id === promptId);
      const text = String(body.text || "").trim().slice(0, 240);

      if (!player) return sendJson(res, 400, { error: "Player not found" });
      if (!prompt) return sendJson(res, 400, { error: "Prompt not found" });
      if (!text)   return sendJson(res, 400, { error: "Answer is required" });

      const assigned = state.promptAssignments[player.id] || [];
      if (!assigned.includes(promptId)) return sendJson(res, 403, { error: "Not assigned to this prompt" });

      state.answers[promptId] = state.answers[promptId] || {};
      state.answers[promptId][player.id] = text;
      touch();
      return sendJson(res, 200, { state: publicState(player.id) });
    }

    // Vote
    if (req.method === "POST" && url.pathname === "/api/vote") {
      const body = await parseBody(req);
      const player = state.players[body.playerId];
      const prompt = currentPrompt();
      if (!player || !prompt) return sendJson(res, 400, { error: "Player or prompt missing" });
      const answers = state.answers[prompt.id] || {};
      const ballot = {};
      let total = 0;
      const maxVotes = (prompt.mode || "all") === "duel" ? 1 : 3;
      for (const [targetId, count] of Object.entries(body.votes || {})) {
        const amount = Math.max(0, Math.min(maxVotes, Number(count || 0)));
        if (!answers[targetId] || targetId === player.id || amount < 1) continue;
        ballot[targetId] = amount;
        total += amount;
      }
      if (total < 1 || total > maxVotes) return sendJson(res, 400, { error: `Use 1–${maxVotes} vote${maxVotes === 1 ? "" : "s"}` });
      state.votes[prompt.id] = state.votes[prompt.id] || {};
      state.votes[prompt.id][player.id] = ballot;
      touch();
      return sendJson(res, 200, { state: publicState(player.id) });
    }

    // Video upload (binary body — must come before the generic /api/host/ JSON handler)
    if (req.method === "POST" && url.pathname === "/api/host/upload-video") {
      if (!requireHost(req, res)) return;
      const rawName = String(req.headers["x-filename"] || "video.bin").replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = path.extname(rawName).toLowerCase();
      if (![".mov", ".mp4", ".webm", ".m4v", ".avi"].includes(ext)) {
        return sendJson(res, 400, { error: "Unsupported file type" });
      }
      const filename = `upload-${Date.now()}${ext}`;
      const videoDir = path.join(PUBLIC_DIR, "videos");
      fs.mkdirSync(videoDir, { recursive: true });
      const dest = path.join(videoDir, filename);
      const ws = fs.createWriteStream(dest);
      let size = 0, aborted = false;
      req.on("data", chunk => {
        size += chunk.length;
        if (size > 500 * 1024 * 1024) {
          aborted = true; ws.destroy();
          try { fs.unlinkSync(dest); } catch {}
          req.destroy();
        } else { ws.write(chunk); }
      });
      req.on("end", () => {
        if (aborted) return;
        ws.end(() => sendJson(res, 200, { url: `/videos/${filename}` }));
      });
      req.on("error", () => { ws.destroy(); try { fs.unlinkSync(dest); } catch {} });
      return;
    }

    // Host actions
    if (req.method === "POST" && url.pathname.startsWith("/api/host/")) {
      if (!requireHost(req, res)) return;
      const action = url.pathname.replace("/api/host/", "");
      const body = await parseBody(req);

      if (action === "reload-prompts") {
        state.prompts = loadPrompts();
      }

      if (action === "save-prompts") {
        const prompts = (body.prompts || []).map((p, i) => ({
          id: String(p.id || `round-${i + 1}`),
          text: String(p.text || "").trim(),
          videoUrl: String(p.videoUrl || "").trim(),
          mode: p.mode === "duel" ? "duel" : "all"
        })).filter(p => p.text || p.videoUrl);
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
        state.prompts = prompts;
      }

      if (action === "demo-lobby") {
        state.phase = "lobby";
        state.phaseStartedAt = Date.now();
        state.round = 0;
        state.roundPromptIds = [];
        state.currentPromptIndex = -1;
        state.currentDuelPlayerIds = [];
        state.promptAssignments = {};
        state.players = {};
        state.answers = {};
        state.votes = {};
        state.scores = {};
        state.roundResults = [];
        createDemoPlayers();
        saveResults();
      }

      if (action === "demo-answers") {
        // Ensure round 1 is started if not already
        if (state.round === 0 && state.prompts.length > 0) startRound(1);
        fillDemoAnswers();
      }

      if (action === "demo-votes") {
        fillDemoVotes();
      }

      if (action === "start-game") {
        startRound(1);
      }

      // Transition from answering → first prompt reveal
      if (action === "start-round-reveal") {
        if (state.roundPromptIds.length > 0) {
          state.currentPromptIndex = 0;
          state.phase = "prompt";
          state.phaseStartedAt = Date.now();
          const p = currentPrompt();
          state.currentDuelPlayerIds = p && (p.mode || "all") === "duel" ? nextDuelPlayers() : [];
        }
      }

      // Advance to next prompt in round, or end round
      if (action === "next-prompt") {
        state.currentPromptIndex += 1;
        if (state.currentPromptIndex >= state.roundPromptIds.length) {
          state.phase = "leaderboard";
        } else {
          state.phase = "prompt";
        }
        state.phaseStartedAt = Date.now();
        const p = currentPrompt();
        state.currentDuelPlayerIds = p && (p.mode || "all") === "duel" ? nextDuelPlayers() : [];
      }

      // Start the next round, or finish
      if (action === "start-next-round") {
        if (state.round < state.totalRounds) {
          startRound(state.round + 1);
        } else {
          state.phase = "finished";
          saveResults();
        }
      }

      if (action === "set-phase") {
        state.phase = body.phase;
        state.phaseStartedAt = Date.now();
        if (state.phase === "results") calculateRoundResults();
        if (state.phase === "finished") saveResults();
      }

      if (action === "reset-game") {
        state.phase = "lobby";
        state.phaseStartedAt = Date.now();
        state.round = 0;
        state.roundPromptIds = [];
        state.currentPromptIndex = -1;
        state.currentDuelPlayerIds = [];
        state.promptAssignments = {};
        state.answers = {};
        state.votes = {};
        state.scores = Object.fromEntries(Object.keys(state.players).map(id => [id, 0]));
        state.roundResults = [];
        saveResults();
      }

      if (action === "set-bachelor") {
        for (const player of Object.values(state.players)) player.isBachelor = player.id === body.playerId;
      }

      if (action === "remove-player") {
        delete state.players[body.playerId];
        delete state.scores[body.playerId];
      }

      touch();
      return sendJson(res, 200, { state: publicState() });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Chuck-Lash running on http://localhost:${PORT}`);
  console.log(`Host PIN: ${HOST_PIN}`);
});
