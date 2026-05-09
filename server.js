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
  currentPromptIndex: -1,
  currentDuelPlayerIds: [],
  players: {},
  prompts: loadPrompts(),
  answers: {},
  votes: {},
  scores: {},
  roundResults: [],
  updatedAt: Date.now()
};

const DEMO_PLAYERS = [
  "Chuck", "Alex", "Jordan", "Taylor", "Morgan", "Sam",
  "Christopher", "Ben", "Nathaniel", "Mike", "Jake", "Will", "Theo", "Marcus", "Danny"
];

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
    JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        roomCode: state.roomCode,
        players: Object.values(state.players),
        scores: state.scores,
        prompts: state.prompts,
        roundResults: state.roundResults
      },
      null,
      2
    )
  );
}

function touch() {
  state.updatedAt = Date.now();
}

function publicState(playerId) {
  const prompt = state.prompts[state.currentPromptIndex] || null;
  const players = Object.values(state.players).sort((a, b) => a.joinedAt - b.joinedAt);
  const answers = currentAnswers();
  const voteSummary = currentVoteSummary();

  return {
    roomCode: state.roomCode,
    phase: state.phase,
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
    myAnswer: playerId && prompt ? state.answers[prompt.id]?.[playerId] || "" : "",
    myVotes: playerId && prompt ? state.votes[prompt.id]?.[playerId] || {} : {},
    updatedAt: state.updatedAt
  };
}

function hideAnswerAuthors(answers, playerId) {
  if (state.phase === "results" || state.phase === "leaderboard" || state.phase === "finished") {
    return answers;
  }
  return answers.map((answer) => ({
    ...answer,
    playerName: answer.playerId === playerId ? "You" : "Anonymous"
  }));
}

function currentPrompt() {
  return state.prompts[state.currentPromptIndex] || null;
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

function calculateRoundResults() {
  const prompt = currentPrompt();
  if (!prompt) return null;
  const existing = state.roundResults.find((result) => result.promptId === prompt.id);
  if (existing) return existing;
  const voteSummary = currentVoteSummary();
  const bachelor = Object.values(state.players).find((player) => player.isBachelor);
  const bachelorBallot = bachelor ? state.votes[prompt.id]?.[bachelor.id] || {} : {};
  const answers = currentAnswers().map((answer) => {
    const votes = voteSummary[answer.playerId] || 0;
    const points = votes * 100;
    const bachelorVotes = Number(bachelorBallot[answer.playerId] || 0);
    const bachelorBonus = bachelorVotes * 100; // each bachelor vote counts double
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

function nextDuelPlayers() {
  const players = Object.values(state.players);
  if (players.length < 2) return [];
  const round = Math.max(0, state.currentPromptIndex);
  return [players[round % players.length].id, players[(round + 1) % players.length].id];
}

function createDemoPlayers() {
  for (const [index, name] of DEMO_PLAYERS.entries()) {
    const id = `demo-${index + 1}`;
    state.players[id] = {
      id,
      name,
      isBachelor: index === 0,
      joinedAt: Date.now() + index
    };
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
  const prompt = currentPrompt();
  if (!prompt) return;
  const answerers = (prompt.mode || "all") === "duel"
    ? Object.values(state.players).filter((player) => state.currentDuelPlayerIds.includes(player.id))
    : Object.values(state.players);
  state.answers[prompt.id] = state.answers[prompt.id] || {};
  for (const player of answerers) {
    state.answers[prompt.id][player.id] = demoAnswerFor(player.name, prompt.text);
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
    const targets = answerIds.filter((id) => id !== player.id);
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

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function requireHost(req, res) {
  const pin = req.headers["x-host-pin"];
  if (pin !== HOST_PIN) {
    sendJson(res, 401, { error: "Invalid host PIN" });
    return false;
  }
  return true;
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, route));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json"
    };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, publicState(url.searchParams.get("playerId")));
    }

    if (req.method === "GET" && url.pathname === "/api/results") {
      return sendJson(res, 200, fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")) : {});
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await parseBody(req);
      const name = String(body.name || "").trim().slice(0, 32);
      if (!name) return sendJson(res, 400, { error: "Name is required" });
      const id = body.playerId && state.players[body.playerId] ? body.playerId : crypto.randomUUID();
      state.players[id] = state.players[id] || {
        id,
        name,
        isBachelor: false,
        joinedAt: Date.now()
      };
      state.players[id].name = name;
      state.scores[id] = state.scores[id] || 0;
      touch();
      return sendJson(res, 200, { playerId: id, state: publicState(id) });
    }

    if (req.method === "POST" && url.pathname === "/api/answer") {
      const body = await parseBody(req);
      const player = state.players[body.playerId];
      const prompt = currentPrompt();
      const text = String(body.text || "").trim().slice(0, 240);
      if (!player || !prompt) return sendJson(res, 400, { error: "Player or prompt missing" });
      if (!text) return sendJson(res, 400, { error: "Answer is required" });
      if ((prompt.mode || "all") === "duel" && !state.currentDuelPlayerIds.includes(player.id)) {
        return sendJson(res, 403, { error: "Only duel players answer this round" });
      }
      state.answers[prompt.id] = state.answers[prompt.id] || {};
      state.answers[prompt.id][player.id] = text;
      touch();
      return sendJson(res, 200, { state: publicState(player.id) });
    }

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
        if (!answers[targetId]) continue;
        if (targetId === player.id) continue;
        if (amount > 0) {
          ballot[targetId] = amount;
          total += amount;
        }
      }
      if (total < 1 || total > maxVotes) {
        return sendJson(res, 400, { error: `Use 1-${maxVotes} vote${maxVotes === 1 ? "" : "s"}` });
      }
      state.votes[prompt.id] = state.votes[prompt.id] || {};
      state.votes[prompt.id][player.id] = ballot;
      touch();
      return sendJson(res, 200, { state: publicState(player.id) });
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/host/")) {
      if (!requireHost(req, res)) return;
      const action = url.pathname.replace("/api/host/", "");
      const body = await parseBody(req);

      if (action === "reload-prompts") {
        state.prompts = loadPrompts();
      }

      if (action === "demo-lobby") {
        state.phase = "lobby";
        state.currentPromptIndex = -1;
        state.currentDuelPlayerIds = [];
        state.players = {};
        state.answers = {};
        state.votes = {};
        state.scores = {};
        state.roundResults = [];
        createDemoPlayers();
        saveResults();
      }

      if (action === "demo-answers") {
        if (!currentPrompt() && state.prompts.length > 0) {
          state.currentPromptIndex = 0;
          state.phase = "answering";
        }
        fillDemoAnswers();
      }

      if (action === "demo-votes") {
        fillDemoVotes();
      }

      if (action === "set-phase") {
        state.phase = body.phase;
        if (state.phase === "results") calculateRoundResults();
        if (state.phase === "finished") saveResults();
      }

      if (action === "start-game") {
        state.currentPromptIndex = 0;
        if (state.prompts.length === 0) {
          state.phase = "finished";
          saveResults();
        } else {
          state.phase = "answering";
          state.currentDuelPlayerIds = (currentPrompt().mode || "all") === "duel" ? nextDuelPlayers() : [];
        }
      }

      if (action === "next-prompt") {
        state.currentPromptIndex += 1;
        if (state.currentPromptIndex >= state.prompts.length) {
          state.phase = "finished";
          saveResults();
        } else {
          state.phase = "answering";
          state.currentDuelPlayerIds = (currentPrompt().mode || "all") === "duel" ? nextDuelPlayers() : [];
        }
      }

      if (action === "previous-prompt") {
        state.currentPromptIndex = Math.max(0, state.currentPromptIndex - 1);
        state.phase = "answering";
        state.currentDuelPlayerIds = (currentPrompt().mode || "all") === "duel" ? nextDuelPlayers() : [];
      }

      if (action === "reset-game") {
        state.phase = "lobby";
        state.currentPromptIndex = -1;
        state.currentDuelPlayerIds = [];
        state.answers = {};
        state.votes = {};
        state.scores = Object.fromEntries(Object.keys(state.players).map((id) => [id, 0]));
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
