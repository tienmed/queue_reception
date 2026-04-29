const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const fsp = fs.promises;

const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const stateFile = path.join(dataDir, "state.json");
const ttsCacheDir = path.join(__dirname, "data", "tts-cache");
const execFileAsync = promisify(execFile);

// Trạng thái mặc định của hệ thống gọi số
const defaultState = {
  streams: {
    bhyt: {
      label: "Bảo Hiểm Y Tế",
      nextNumber: 0,
      counters: {
        quay1: { label: "Quầy 1", currentNumber: 0, lastCalledAt: null },
        quay2: { label: "Quầy 2", currentNumber: 0, lastCalledAt: null },
        quay3: { label: "Quầy 3", currentNumber: 0, lastCalledAt: null }
      },
      announcementTemplate: "Mời số thứ tự {{number}} tới quầy tiếp nhận Bảo hiểm Y tế."
    },
    thuPhi: {
      label: "Thu Phí",
      nextNumber: 0,
      counters: {
        quay1: { label: "Quầy 1", currentNumber: 0, lastCalledAt: null },
        quay2: { label: "Quầy 2", currentNumber: 0, lastCalledAt: null },
        quay3: { label: "Quầy 3", currentNumber: 0, lastCalledAt: null }
      },
      announcementTemplate: "Mời số thứ tự {{number}} tới quầy Thu Phí."
    },
    khamDoan: {
      label: "Khám Đoàn",
      nextNumber: 0,
      counters: {
        quay1: { label: "Quầy 1", currentNumber: 0, lastCalledAt: null },
        quay2: { label: "Quầy 2", currentNumber: 0, lastCalledAt: null },
        quay3: { label: "Quầy 3", currentNumber: 0, lastCalledAt: null }
      },
      announcementTemplate: "Mời số thứ tự {{number}} tới quầy Khám Đoàn."
    }
  }
};

// Hàm tạo bản sao trạng thái mặc định
function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

// Chuẩn hóa dữ liệu trạng thái
function normalizeState(rawState) {
  const nextState = cloneDefaultState();

  if (!rawState || typeof rawState !== "object") {
    return nextState;
  }

  if (!rawState.streams || typeof rawState.streams !== "object") {
    if (Number.isInteger(rawState.currentNumber)) {
      nextState.streams.bhyt.nextNumber = rawState.currentNumber;
      nextState.streams.bhyt.counters.quay1.currentNumber = rawState.currentNumber;
    }
    return nextState;
  }

  for (const [streamKey, streamDefaults] of Object.entries(nextState.streams)) {
    const rawStream = rawState.streams[streamKey] || {};
    const fallbackCurrentNumber = Number.isInteger(rawStream.currentNumber) ? rawStream.currentNumber : streamDefaults.nextNumber;
    const nextNumber = Number.isInteger(rawStream.nextNumber) ? rawStream.nextNumber : fallbackCurrentNumber;

    const normalizedCounters = {};
    for (const [counterKey, counterDefaults] of Object.entries(streamDefaults.counters)) {
      const rawCounter = rawStream.counters?.[counterKey] || {};
      const fallbackCounterNumber = counterKey === "quay1" ? nextNumber : counterDefaults.currentNumber;
      normalizedCounters[counterKey] = {
        label:
          typeof rawCounter.label === "string" && rawCounter.label.trim() ? rawCounter.label.trim() : counterDefaults.label,
        currentNumber: Number.isInteger(rawCounter.currentNumber) ? rawCounter.currentNumber : fallbackCounterNumber,
        lastCalledAt: typeof rawCounter.lastCalledAt === "string" && rawCounter.lastCalledAt ? rawCounter.lastCalledAt : null
      };
    }

    nextState.streams[streamKey] = {
      label: typeof rawStream.label === "string" && rawStream.label.trim() ? rawStream.label.trim() : streamDefaults.label,
      nextNumber,
      counters: normalizedCounters,
      announcementTemplate:
        typeof rawStream.announcementTemplate === "string" && rawStream.announcementTemplate.trim()
          ? rawStream.announcementTemplate.trim()
          : streamDefaults.announcementTemplate
    };
  }

  return nextState;
}

// Đảm bảo file dữ liệu tồn tại
function ensureStateFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify(defaultState, null, 2));
  }
}

// Đọc trạng thái từ file
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

let pendingStateWrite = Promise.resolve();

// Ghi trạng thái vào file (xếp hàng async để tránh block event-loop)
function writeState(nextState) {
  ensureStateFile();
  const serializedState = JSON.stringify(nextState, null, 2);
  pendingStateWrite = pendingStateWrite
    .then(() => fsp.writeFile(stateFile, serializedState))
    .catch((error) => {
      console.error("[STATE_WRITE_ERROR] Không thể ghi state:", error);
    });
}

let queueState = readState();
console.log(`[DEBUG_INIT] queueState loaded. Streams: ${Object.keys(queueState.streams).join(', ')}`);

const ttsMemoryCache = new Map();
const pendingTtsJobs = new Map();
const prewarmJobs = new Map();
const TTS_CACHE_LIMIT = 100;
let ensureTtsCacheDirPromise = null;
let callLogsByStream = {};
let callLogDateKey = new Date().toISOString().slice(0, 10);

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDailyLogWindow() {
  const today = getDateKey();
  if (today !== callLogDateKey) {
    callLogsByStream = {};
    callLogDateKey = today;
  }
}

function getCounterLog(streamKey, counterKey) {
  if (!callLogsByStream[streamKey]) {
    callLogsByStream[streamKey] = {};
  }

  if (!callLogsByStream[streamKey][counterKey]) {
    callLogsByStream[streamKey][counterKey] = [];
  }

  return callLogsByStream[streamKey][counterKey];
}

function addCallLog(entry) {
  ensureDailyLogWindow();
  const { streamKey, counterKey } = entry;
  const targetLog = getCounterLog(streamKey, counterKey);

  targetLog.unshift({
    id: crypto.randomUUID(),
    calledAt: new Date().toISOString(),
    ...entry
  });

  if (targetLog.length > 1000) {
    targetLog.length = 1000;
  }
}

function clearStreamLogs(streamKey) {
  ensureDailyLogWindow();
  if (callLogsByStream[streamKey]) {
    callLogsByStream[streamKey] = {};
  }
}

function ensureTtsCacheDir() {
  if (!ensureTtsCacheDirPromise) {
    ensureTtsCacheDirPromise = fsp.mkdir(ttsCacheDir, { recursive: true });
  }

  return ensureTtsCacheDirPromise;
}

function buildTtsCacheKey(text, voice) {
  return crypto.createHash("sha1").update(`${voice || ""}::${text}`).digest("hex");
}

function rememberTtsBuffer(cacheKey, audioBuffer) {
  if (ttsMemoryCache.has(cacheKey)) {
    ttsMemoryCache.delete(cacheKey);
  }
  ttsMemoryCache.set(cacheKey, audioBuffer);

  if (ttsMemoryCache.size > TTS_CACHE_LIMIT) {
    const firstKey = ttsMemoryCache.keys().next().value;
    ttsMemoryCache.delete(firstKey);
  }
}
async function readCacheFile(cachePath) {
  try {
    return await fsp.readFile(cachePath);
  } catch (_error) {
    return null;
  }
}

// Phát thông báo cập nhật trạng thái qua Socket.io
function broadcastState() {
  io.emit("queue:update", queueState);
}

// Xây dựng nội dung văn bản thông báo
function buildAnnouncementText(template, currentNumber, label = "tiếp nhận") {
  const safeTemplate =
    typeof template === "string" && template.trim() ? template.trim() : "Mời khách hàng số {{number}} tới quầy {{quay}}.";

  return safeTemplate
    .replaceAll("{{number}}", String(currentNumber).padStart(3, "0"))
    .replaceAll("{{quay}}", label);
}

function buildStreamAnnouncementText(stream, number, counterLabel) {
  const label = counterLabel || stream.label;
  return buildAnnouncementText(stream.announcementTemplate, number, label);
}

async function resolveAnnouncementAudio({ stream, streamKey, counter, counterKey, voice, number, allowGenerate }) {
  let audioBuffer = await findCachedAudio(voice, streamKey, counterKey, number);

  if (audioBuffer || !allowGenerate) {
    return audioBuffer;
  }

  const announcementText = buildStreamAnnouncementText(stream, number, counter.label);
  console.log(`[API] Cache miss, generating: "${announcementText}"`);
  audioBuffer = await generateAndCacheTts(announcementText, voice, streamKey, counterKey, number);
  return audioBuffer;
}

async function prewarmNextAnnouncementAudio({ stream, streamKey, counter, counterKey, voice, currentNumber }) {
  const nextNumber = Math.max(0, Number(currentNumber || 0) + 1);
  const jobKey = `${voice}:${streamKey}:${counterKey}:${nextNumber}`;

  if (prewarmJobs.has(jobKey)) {
    return prewarmJobs.get(jobKey);
  }

  const prewarmJob = (async () => {
    const existingAudio = await findCachedAudio(voice, streamKey, counterKey, nextNumber);
    if (existingAudio) {
      return;
    }

    const nextText = buildStreamAnnouncementText(stream, nextNumber, counter.label);
    console.log(`[PREWARM] Tạo sẵn WAV cho số kế tiếp ${String(nextNumber).padStart(3, "0")}`);
    await generateAndCacheTts(nextText, voice, streamKey, counterKey, nextNumber);
  })();

  prewarmJobs.set(jobKey, prewarmJob);

  try {
    await prewarmJob;
  } finally {
    prewarmJobs.delete(jobKey);
  }
}

// --- Ánh xạ Voice & Stream (module-level) ---
const voiceMapping = {
  "bich_ngoc": "Bích Ngọc (Nữ - Miền Bắc)",
  "pham_tuyen": "Phạm Tuyên (Nam - Miền Bắc)",
  "thuc_doan": "Thục Đoan (Nữ - Miền Nam)",
  "xuan_vinh": "Xuân Vĩnh (Nam - Miền Nam)"
};

const streamFileMapping = {
  "bhyt": "bhyt",
  "thuphi": "thu_phi",
  "khamdoan": "kham_doan"
};

// Tìm đường dẫn Python tự động (ưu tiên biến môi trường, fallback sang PATH)
const pythonPath = process.env.PYTHON_PATH || "python";
const bridgePath = path.join(__dirname, "tts_bridge.py");

/**
 * Tạo đường dẫn file cache theo cấu trúc: voiceId_streamKey_counterKey_number.wav
 * (fallback tương thích ngược: voiceId_streamKey_number.wav)
 * @returns {{ filename: string, filepath: string } | null}
 */
function buildPregenPath(voiceId, streamKey, counterKey, number) {
  if (!voiceId || !streamKey || number === undefined) return null;
  const streamFileKey = streamFileMapping[streamKey.toLowerCase()] || streamKey.toLowerCase();
  const normalizedCounterKey = counterKey ? String(counterKey).toLowerCase() : null;
  const numberStr = String(number).padStart(3, "0");
  const filename = normalizedCounterKey
    ? `${voiceId}_${streamFileKey}_${normalizedCounterKey}_${numberStr}.wav`
    : `${voiceId}_${streamFileKey}_${numberStr}.wav`;
  return { filename, filepath: path.join(ttsCacheDir, filename) };
}

/**
 * Tìm file WAV đã cache sẵn trong data/tts-cache
 * @returns {Buffer | null}
 */
async function findCachedAudio(voiceId, streamKey, counterKey, number) {
  const candidatePaths = [
    buildPregenPath(voiceId, streamKey, counterKey, number),
    buildPregenPath(voiceId, streamKey, null, number)
  ].filter(Boolean);

  for (const info of candidatePaths) {
    console.log(`[TTS_CACHE_LOOKUP] Looking for: ${info.filename}`);
    if (fs.existsSync(info.filepath)) {
      console.log(`[TTS_CACHE_HIT] Sử dụng file: ${info.filename}`);
      return await fsp.readFile(info.filepath);
    }
  }

  const firstCandidate = candidatePaths[0];
  console.log(`[TTS_CACHE_MISS] Không tìm thấy: ${firstCandidate ? firstCandidate.filename : "unknown"}`);
  return null;
}

/**
 * Tổng hợp giọng nói và lưu file theo cấu trúc tên chuẩn voice_stream_counter_number.wav
 * @returns {Buffer}
 */
async function generateAndCacheTts(text, voiceId, streamKey, counterKey, number) {
  await ensureTtsCacheDir();

  const voiceName = voiceMapping[voiceId] || voiceId;
  const info = buildPregenPath(voiceId, streamKey, counterKey, number);
  const outputPath = info
    ? info.filepath
    : path.join(ttsCacheDir, `${buildTtsCacheKey(text, voiceName)}.wav`);

  console.log(`[TTS_GENERATE] Tạo mới: "${text.substring(0, 40)}..." → ${info ? info.filename : path.basename(outputPath)}`);

  try {
    await execFileAsync(
      pythonPath,
      [bridgePath, text, "--output", outputPath, "--voice", voiceName],
      { timeout: 120000 }
    );

    const audioBuffer = await readCacheFile(outputPath);
    if (audioBuffer) {
      console.log(`[TTS_GENERATE_OK] Đã tạo xong: ${path.basename(outputPath)} (${audioBuffer.length} bytes)`);
      return audioBuffer;
    }

    throw new Error("Không tìm thấy file output TTS sau khi chạy bridge");
  } catch (error) {
    console.error(`[TTS_GENERATE_ERROR] ${error.message}`);

    // Fallback sang Google TTS
    console.warn(`[TTS_FALLBACK] Dùng Google TTS: ${error.message}`);
    try {
      const googleTts = require("google-tts-api");
      const audioBase64 = await googleTts.getAudioBase64(text, {
        lang: "vi",
        slow: false,
        timeout: 10000
      });

      const audioBuffer = Buffer.from(audioBase64, "base64");
      // Lưu vào đúng vị trí cache để lần sau tìm được
      void fsp.writeFile(outputPath, audioBuffer).catch(e => console.error("Lưu cache thất bại:", e));
      return audioBuffer;
    } catch (googleError) {
      console.error("[TTS_CRITICAL] Cả VieNeu và Google TTS đều thất bại:", googleError);
      throw googleError;
    }
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Chuyển hướng trang chủ sang viewer
app.get("/", (_req, res) => {
  res.redirect("/viewer");
});

// Trang hiển thị số thứ tự
app.get("/viewer", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "viewer.html"));
});

// Trang điều khiển
app.get("/control", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "control.html"));
});

// API lấy trạng thái hiện tại
app.get("/api/state", (_req, res) => {
  res.json(queueState);
});

app.get("/api/logs", (req, res) => {
  ensureDailyLogWindow();
  const { streamKey, counterKey } = req.query;

  if (typeof streamKey === "string" && typeof counterKey === "string") {
    res.json({
      date: callLogDateKey,
      streamKey,
      counterKey,
      logs: getCounterLog(streamKey, counterKey)
    });
    return;
  }

  if (typeof streamKey === "string") {
    res.json({
      date: callLogDateKey,
      streamKey,
      logsByCounter: callLogsByStream[streamKey] || {}
    });
    return;
  }

  res.json({
    date: callLogDateKey,
    logsByStream: callLogsByStream
  });
});

// API tăng số thứ tự
app.post("/api/increment", (req, res) => {
  const { streamKey, counterKey = "quay1" } = req.body;
  const stream = queueState.streams[streamKey];
  const counter = stream?.counters?.[counterKey];

  if (!stream || !counter) {
    res.status(400).json({ message: "Luồng không hợp lệ." });
    return;
  }

  stream.nextNumber += 1;
  counter.currentNumber = stream.nextNumber;
  counter.lastCalledAt = new Date().toISOString();
  addCallLog({
    streamKey,
    streamLabel: stream.label,
    counterKey,
    counterLabel: counter.label,
    number: stream.nextNumber
  });

  writeState(queueState);
  broadcastState();
  res.json(queueState);
});

// API tăng số, phát thông báo số mới
// Logic: +1 → tìm file cache → nếu không có thì generate mới theo cấu trúc voice_stream_number.wav
app.post("/api/increment-and-announce", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice = "bich_ngoc" } = req.body;
    console.log(`[API] Increment & Announce: stream=${streamKey}, counter=${counterKey}, voice=${voice}`);

    const stream = queueState.streams[streamKey];
    const counter = stream?.counters?.[counterKey];

    if (!stream || !counter) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    // +1 số thứ tự
    stream.nextNumber += 1;
    counter.currentNumber = stream.nextNumber;
    counter.lastCalledAt = new Date().toISOString();

    addCallLog({
      streamKey,
      streamLabel: stream.label,
      counterKey,
      counterLabel: counter.label,
      number: stream.nextNumber
    });

    writeState(queueState);
    broadcastState();

    const audioBuffer = await resolveAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      number: stream.nextNumber,
      allowGenerate: true
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Queue-Stream-Key", streamKey);
    res.setHeader("X-Queue-Counter-Key", counterKey);
    res.setHeader("X-Queue-Number", String(stream.nextNumber));
    res.send(audioBuffer);

    void prewarmNextAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      currentNumber: stream.nextNumber
    }).catch((error) => {
      console.error("[PREWARM_ERROR] increment:", error);
    });
  } catch (error) {
    console.error("[TTS_ERROR] Lỗi tăng số + phát loa:", error);
    res.status(500).json({ message: "Không thể tăng số và phát loa." });
  }
});

// API gọi lại số cũ, phát thông báo số trước theo quầy hiện tại
// Logic: giảm counter.currentNumber của quầy, không lùi stream.nextNumber toàn luồng
app.post("/api/decrement-and-announce", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice = "bich_ngoc" } = req.body;
    console.log(`[API] Decrement & Announce: stream=${streamKey}, counter=${counterKey}, voice=${voice}`);

    const stream = queueState.streams[streamKey];
    const counter = stream?.counters?.[counterKey];

    if (!stream || !counter) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    // Gọi lại số cũ: chỉ lùi số cục bộ của quầy để phát lại số trước,
    // không thay đổi số tiến trình toàn luồng.
    if (counter.currentNumber > 0) {
      counter.currentNumber -= 1;
    }
    counter.lastCalledAt = new Date().toISOString();

    addCallLog({
      streamKey,
      streamLabel: stream.label,
      counterKey,
      counterLabel: counter.label,
      number: counter.currentNumber
    });

    writeState(queueState);
    broadcastState();

    const audioBuffer = await resolveAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      number: counter.currentNumber,
      allowGenerate: true
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Queue-Stream-Key", streamKey);
    res.setHeader("X-Queue-Counter-Key", counterKey);
    res.setHeader("X-Queue-Number", String(counter.currentNumber));
    res.send(audioBuffer);

    void prewarmNextAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      currentNumber: stream.nextNumber
    }).catch((error) => {
      console.error("[PREWARM_ERROR] decrement:", error);
    });
  } catch (error) {
    console.error("[TTS_ERROR] Lỗi giảm số + phát loa:", error);
    res.status(500).json({ message: "Không thể giảm số và phát loa." });
  }
});


// API cập nhật trạng thái luồng cụ thể
app.post("/api/state", (req, res) => {
  const { streamKey, counterKey = "quay1", currentNumber, announcementTemplate, voice = "bich_ngoc" } = req.body;
  const stream = queueState.streams[streamKey];
  const counter = stream?.counters?.[counterKey];

  if (!stream || !counter) {
    res.status(400).json({ message: "Luồng không hợp lệ." });
    return;
  }

  const nextNumber = Number.parseInt(currentNumber, 10);
  if (!Number.isInteger(nextNumber) || nextNumber < 0) {
    res.status(400).json({ message: "Số thứ tự không hợp lệ." });
    return;
  }

  stream.nextNumber = nextNumber;
  clearStreamLogs(streamKey);
  // Reset theo toàn bộ luồng: đồng bộ số hiện tại cho tất cả quầy trong stream
  Object.values(stream.counters).forEach((streamCounter) => {
    streamCounter.currentNumber = nextNumber;
  });

  if (typeof announcementTemplate === "string" && announcementTemplate.trim()) {
    stream.announcementTemplate = announcementTemplate.trim();
  }

  writeState(queueState);
  broadcastState();
  res.json(queueState);

  void prewarmNextAnnouncementAudio({
    stream,
    streamKey,
    counter,
    counterKey,
    voice,
    currentNumber: nextNumber
  }).catch((error) => {
    console.error("[PREWARM_ERROR] state-set:", error);
  });
});

// API phát loa lại số hiện tại (ưu tiên cache, thiếu file thì generate mới để không rớt tiếng gọi)
app.post("/api/announce", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice = "bich_ngoc" } = req.body;
    const stream = queueState.streams[streamKey];
    const counter = stream?.counters?.[counterKey];

    if (!stream || !counter) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    const audioBuffer = await resolveAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      number: counter.currentNumber,
      allowGenerate: true
    });

    if (!audioBuffer) {
      const info = buildPregenPath(voice, streamKey, counterKey, counter.currentNumber);
      const expectedFile = info ? info.filename : "unknown";
      console.warn(`[ANNOUNCE] Không tìm thấy file âm thanh: ${expectedFile}`);
      res.status(404).json({
        message: `Chưa có file âm thanh phát loa cho số ${String(counter.currentNumber).padStart(3, "0")}. File cần: ${expectedFile}`
      });
      return;
    }

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Queue-Stream-Key", streamKey);
    res.setHeader("X-Queue-Counter-Key", counterKey);
    res.setHeader("X-Queue-Number", String(counter.currentNumber));
    res.send(audioBuffer);

    void prewarmNextAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      currentNumber: counter.currentNumber
    }).catch((error) => {
      console.error("[PREWARM_ERROR] announce:", error);
    });
  } catch (error) {
    console.error("Lỗi phát loa:", error);
    res.status(500).json({ message: "Không thể phát loa." });
  }
});

// API tải sẵn audio cho một số cụ thể (không đổi trạng thái)
app.post("/api/announcement-preview", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice = "bich_ngoc", number, allowGenerate = false } = req.body;
    const stream = queueState.streams[streamKey];
    const counter = stream?.counters?.[counterKey];
    const targetNumber = Number.parseInt(number, 10);

    if (!stream || !counter) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    if (!Number.isInteger(targetNumber) || targetNumber < 0) {
      res.status(400).json({ message: "Số cần tải sẵn không hợp lệ." });
      return;
    }

    const audioBuffer = await resolveAnnouncementAudio({
      stream,
      streamKey,
      counter,
      counterKey,
      voice,
      number: targetNumber,
      allowGenerate: Boolean(allowGenerate)
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("[PREVIEW_ERROR] Không thể tải sẵn audio:", error);
    res.status(500).json({ message: "Không thể tải sẵn âm thanh." });
  }
});

// API thông báo nội dung tùy chỉnh (generate mới, không dùng cache chuẩn)
app.post("/api/announce-custom", async (req, res) => {
  try {
    const { text, voice = "bich_ngoc" } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ message: "Nội dung thông báo không được để trống." });
      return;
    }

    const audioBuffer = await generateAndCacheTts(text.trim(), voice, null, null, null);

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("Lỗi tạo âm thanh TTS tùy chỉnh:", error);
    res.status(500).json({ message: "Không tạo được audio TTS tùy chỉnh." });
  }
});

// API thông báo đầu ca (sử dụng file cache sẵn voice_start.wav)
app.post("/api/announce-start", async (req, res) => {
  try {
    const { voice = "bich_ngoc" } = req.body;
    const filename = `${voice}_start.wav`;
    const filePath = path.join(ttsCacheDir, filename);

    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "audio/wav");
      res.setHeader("Cache-Control", "no-store");
      const audioBuffer = await fsp.readFile(filePath);
      res.send(audioBuffer);
    } else {
      console.warn(`[ANNOUNCE-START] Không tìm thấy file âm thanh: ${filename}`);
      res.status(404).json({ message: "Không tìm thấy file thông báo đầu ca." });
    }
  } catch (error) {
    console.error("Lỗi phát loa đầu ca:", error);
    res.status(500).json({ message: "Không thể phát loa đầu ca." });
  }
});

// Xử lý kết nối Socket.io
io.on("connection", (socket) => {
  socket.emit("queue:update", queueState);
});

// Khởi động server
try {
  server.listen(PORT, () => {
    console.log(`Ứng dụng đang chạy tại http://localhost:${PORT}`);
  });
} catch (startError) {
  console.error("Lỗi nghiêm trọng khi khởi động server:", startError);
}

process.on('uncaughtException', (err) => {
  console.error('Lỗi chưa được xử lý (Uncaught Exception):', err);
});
