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

// Ghi trạng thái vào file
function writeState(nextState) {
  ensureStateFile();
  fs.writeFileSync(stateFile, JSON.stringify(nextState, null, 2));
}

let queueState = readState();
console.log(`[DEBUG_INIT] queueState loaded. Streams: ${Object.keys(queueState.streams).join(', ')}`);

const ttsMemoryCache = new Map();
const pendingTtsJobs = new Map();
const TTS_CACHE_LIMIT = 100;
let ensureTtsCacheDirPromise = null;
let callLogs = [];
let callLogDateKey = new Date().toISOString().slice(0, 10);

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

function ensureDailyLogWindow() {
  const today = getDateKey();
  if (today !== callLogDateKey) {
    callLogs = [];
    callLogDateKey = today;
  }
}

function addCallLog(entry) {
  ensureDailyLogWindow();
  callLogs.unshift({
    id: crypto.randomUUID(),
    calledAt: new Date().toISOString(),
    ...entry
  });

  if (callLogs.length > 1000) {
    callLogs.length = 1000;
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

// Hàm tổng hợp giọng nói tiếng Việt
async function synthesizeVietnameseSpeech(text, options = {}) {
  await ensureTtsCacheDir();
  const bridgePath = path.join(__dirname, "tts_bridge.py");
  const voice = options.voice || "Bích Ngọc (Nữ - Miền Bắc)";
  const cacheKey = buildTtsCacheKey(text, voice);

  const refreshCache = options.refreshCache === true;
  const skipCache = options.skipCache === true;

  // Nếu skipCache là true, ta dùng một file tạm và không lưu vào Map/Disk cache chung
  const cachePath = skipCache
    ? path.join(ttsCacheDir, `temp_${crypto.randomUUID()}.wav`)
    : path.join(ttsCacheDir, `${cacheKey}.wav`);

  const pythonPath = "C:\\Users\\Thinkpad X280\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";

  if (!skipCache && !refreshCache && ttsMemoryCache.has(cacheKey)) {
    return ttsMemoryCache.get(cacheKey);
  }

  if (!skipCache && !refreshCache) {
    const cachedBuffer = await readCacheFile(cachePath);
    if (cachedBuffer) {
      rememberTtsBuffer(cacheKey, cachedBuffer);
      return cachedBuffer;
    }
  }

  if (!skipCache && !refreshCache && pendingTtsJobs.has(cacheKey)) {
    return pendingTtsJobs.get(cacheKey);
  }

  const ttsJob = (async () => {
    try {
      // Nếu là refreshCache, xóa file cũ trên đĩa trước khi tạo mới để đảm bảo file được thay thế dứt điểm
      if (refreshCache && fs.existsSync(cachePath)) {
        await fsp.unlink(cachePath).catch(() => { });
      }

      // Giảm timeout xuống 7s để tránh treo lâu nếu mạng HF chậm
      await execFileAsync(
        pythonPath,
        [bridgePath, text, "--output", cachePath, "--voice", voice],
        { timeout: 7000 }
      );

      const audioBuffer = await readCacheFile(cachePath);

      // Nếu là skipCache, xóa file tạm sau khi đọc xong
      if (skipCache) {
        void fsp.unlink(cachePath).catch(() => { });
      }

      if (audioBuffer) {
        if (!skipCache) rememberTtsBuffer(cacheKey, audioBuffer);
        return audioBuffer;
      }

      throw new Error("Không tìm thấy file output TTS sau khi chạy bridge");
    } catch (error) {
      if (skipCache) {
        void fsp.unlink(cachePath).catch(() => { });
      }

      console.warn(`[TTS_FALLBACK] VieNeu-TTS lỗi hoặc quá 7s, dùng Google TTS: ${error.message}`);

      try {
        const googleTts = require("google-tts-api");
        const audioBase64 = await googleTts.getAudioBase64(text, {
          lang: "vi",
          slow: false,
          timeout: 10000
        });

        const audioBuffer = Buffer.from(audioBase64, "base64");

        if (!skipCache) {
          rememberTtsBuffer(cacheKey, audioBuffer);
          // Lưu vào cache đĩa để lần sau nhanh hơn
          void fsp.writeFile(cachePath, audioBuffer).catch(e => console.error("Lưu cache đĩa thất bại:", e));
        }

        return audioBuffer;
      } catch (googleError) {
        console.error("[TTS_CRITICAL] Cả VieNeu và Google TTS đều thất bại:", googleError);
        throw googleError;
      }
    }
  })();

  if (!skipCache) {
    pendingTtsJobs.set(cacheKey, ttsJob);
  }

  try {
    return await ttsJob;
  } finally {
    if (!skipCache) pendingTtsJobs.delete(cacheKey);
  }
}

async function prewarmNextAnnouncement(stream, voice, counterLabel) {
  const nextNumber = stream.nextNumber + 1;
  const nextText = buildStreamAnnouncementText(stream, nextNumber, counterLabel);
  const nextVoice = voice || "Bích Ngọc (Nữ - Miền Bắc)";
  const cacheKey = buildTtsCacheKey(nextText, nextVoice);

  if (ttsMemoryCache.has(cacheKey) || pendingTtsJobs.has(cacheKey)) {
    return;
  }

  await ensureTtsCacheDir();
  const cachePath = path.join(ttsCacheDir, `${cacheKey}.wav`);
  const existingCache = await readCacheFile(cachePath);
  if (existingCache) {
    rememberTtsBuffer(cacheKey, existingCache);
    return;
  }

  synthesizeVietnameseSpeech(nextText, { voice: nextVoice }).catch((error) => {
    console.error("Không thể prewarm TTS cho số tiếp theo:", error);
  });
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

app.get("/api/logs", (_req, res) => {
  ensureDailyLogWindow();
  res.json({
    date: callLogDateKey,
    logs: callLogs
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

// API tăng số, phát thông báo số mới và prewarm âm thanh cho số kế tiếp
app.post("/api/increment-and-announce", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice, refreshCache } = req.body;

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

    const currentText = buildStreamAnnouncementText(stream, stream.nextNumber, counter.label);

    const audioBufferPromise = synthesizeVietnameseSpeech(currentText, { voice, refreshCache });

    // Prewarm chạy ngầm, không block request hiện tại
    void prewarmNextAnnouncement(stream, voice, counter.label);

    const audioBuffer = await audioBufferPromise;

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("[TTS_ERROR] Lỗi tăng số + phát loa:", error);
    res.status(500).json({ message: "Không thể tăng số và phát loa." });
  }
});

// API cập nhật trạng thái luồng cụ thể
app.post("/api/state", (req, res) => {
  const { streamKey, counterKey = "quay1", currentNumber, announcementTemplate } = req.body;
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
  counter.currentNumber = nextNumber;

  if (typeof announcementTemplate === "string" && announcementTemplate.trim()) {
    stream.announcementTemplate = announcementTemplate.trim();
  }

  writeState(queueState);
  broadcastState();
  res.json(queueState);
});

// API gọi thông báo TTS (Dựa trên câu mẫu)
app.post("/api/announce", async (req, res) => {
  try {
    const { streamKey, counterKey = "quay1", voice, refreshCache } = req.body;
    const stream = queueState.streams[streamKey];
    const counter = stream?.counters?.[counterKey];

    if (!stream || !counter) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    const text = buildStreamAnnouncementText(stream, counter.currentNumber, counter.label);
    const audioBuffer = await synthesizeVietnameseSpeech(text, { voice, refreshCache });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("Lỗi tạo âm thanh TTS:", error);
    res.status(500).json({ message: "Không tạo được audio TTS." });
  }
});

// API thông báo nội dung tùy chỉnh
app.post("/api/announce-custom", async (req, res) => {
  try {
    const { text, voice, refreshCache } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ message: "Nội dung thông báo không được để trống." });
      return;
    }

    const audioBuffer = await synthesizeVietnameseSpeech(text.trim(), { voice, refreshCache, skipCache: true });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(audioBuffer);
  } catch (error) {
    console.error("Lỗi tạo âm thanh TTS tùy chỉnh:", error);
    res.status(500).json({ message: "Không tạo được audio TTS tùy chỉnh." });
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
