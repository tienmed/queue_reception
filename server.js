const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const googleTts = require("google-tts-api/dist");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const stateFile = path.join(dataDir, "state.json");
const ttsOptions = {
  voice: "vi-VN-HoaiMyNeural",
  rate: "-6%",
  volume: "+0%",
  pitch: "+0Hz"
};
const defaultState = {
  streams: {
    bhyt: {
      label: "BHYT",
      currentNumber: 0,
      announcementTemplate: "Moi so thu tu {{number}} toi quay tiep nhan BHYT."
    },
    thuPhi: {
      label: "Thu phi",
      currentNumber: 0,
      announcementTemplate: "Moi so thu tu {{number}} toi quay thu phi."
    },
    khamDoan: {
      label: "Kham doan",
      currentNumber: 0,
      announcementTemplate: "Moi so thu tu {{number}} toi quay kham doan."
    }
  }
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function normalizeState(rawState) {
  const nextState = cloneDefaultState();

  if (!rawState || typeof rawState !== "object") {
    return nextState;
  }

  if (!rawState.streams || typeof rawState.streams !== "object") {
    if (Number.isInteger(rawState.currentNumber)) {
      nextState.streams.bhyt.currentNumber = rawState.currentNumber;
    }
    return nextState;
  }

  for (const [streamKey, streamDefaults] of Object.entries(nextState.streams)) {
    const rawStream = rawState.streams[streamKey] || {};

    nextState.streams[streamKey] = {
      label: typeof rawStream.label === "string" && rawStream.label.trim() ? rawStream.label.trim() : streamDefaults.label,
      currentNumber: Number.isInteger(rawStream.currentNumber) ? rawStream.currentNumber : streamDefaults.currentNumber,
      announcementTemplate:
        typeof rawStream.announcementTemplate === "string" && rawStream.announcementTemplate.trim()
          ? rawStream.announcementTemplate.trim()
          : streamDefaults.announcementTemplate
    };
  }

  return nextState;
}

function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify(defaultState, null, 2));
  }
}

function readState() {
  ensureStateFile();

  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (_error) {
    return cloneDefaultState();
  }
}

function writeState(nextState) {
  ensureStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(nextState, null, 2));
}

let queueState = readState();

function broadcastState() {
  io.emit("queue:update", queueState);
}

function buildAnnouncementText(template, currentNumber) {
  const safeTemplate =
    typeof template === "string" && template.trim() ? template.trim() : "Moi so thu tu {{number}} toi quay tiep nhan.";

  return safeTemplate.replaceAll("{{number}}", String(currentNumber).padStart(3, "0"));
}

async function synthesizeVietnameseSpeech(text) {
  const audioBase64 = await googleTts.getAudioBase64(text, {
    lang: "vi",
    slow: false,
    timeout: 15000
  });

  return Buffer.from(audioBase64, "base64");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.redirect("/viewer");
});

app.get("/viewer", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "viewer.html"));
});

app.get("/control", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "control.html"));
});

app.get("/api/state", (_req, res) => {
  res.json(queueState);
});

app.post("/api/increment", (req, res) => {
  const { streamKey } = req.body;

  if (!queueState.streams[streamKey]) {
    res.status(400).json({ message: "Luong khong hop le." });
    return;
  }

  queueState.streams[streamKey].currentNumber += 1;
  writeState(queueState);
  broadcastState();
  res.json(queueState);
});

app.post("/api/state", (req, res) => {
  const { streamKey, currentNumber, announcementTemplate } = req.body;
  const stream = queueState.streams[streamKey];

  if (!stream) {
    res.status(400).json({ message: "Luong khong hop le." });
    return;
  }

  const nextNumber = Number.parseInt(currentNumber, 10);
  if (!Number.isInteger(nextNumber) || nextNumber < 0) {
    res.status(400).json({ message: "So thu tu khong hop le." });
    return;
  }

  stream.currentNumber = nextNumber;

  if (typeof announcementTemplate === "string" && announcementTemplate.trim()) {
    stream.announcementTemplate = announcementTemplate.trim();
  }

  writeState(queueState);
  broadcastState();
  res.json(queueState);
});

app.post("/api/announce", async (req, res) => {
  try {
    const { streamKey } = req.body;
    const stream = queueState.streams[streamKey];

    if (!stream) {
      res.status(400).json({ message: "Luong khong hop le." });
      return;
    }

    const text = buildAnnouncementText(stream.announcementTemplate, stream.currentNumber);
    const audioBuffer = await synthesizeVietnameseSpeech(text);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("TTS generation failed:", error);
    res.status(500).json({ message: "Khong tao duoc audio TTS." });
  }
});

io.on("connection", (socket) => {
  socket.emit("queue:update", queueState);
});

server.listen(PORT, () => {
  console.log(`Queue display app running at http://localhost:${PORT}`);
});
