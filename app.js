const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, "data");
const stateFile = path.join(dataDir, "state.json");

// Các tùy chọn mặc định cho TTS (nếu dùng Google làm dự phòng)
const ttsOptions = {
  voice: "vi-VN-HoaiMyNeural",
  rate: "-6%",
  volume: "+0%",
  pitch: "+0Hz"
};

// Trạng thái mặc định của hệ thống gọi số
const defaultState = {
  streams: {
    bhyt: {
      label: "Bảo Hiểm Y Tế",
      currentNumber: 0,
      announcementTemplate: "Mời số thứ tự {{number}} tới quầy tiếp nhận Bảo hiểm Y tế."
    },
    thuPhi: {
      label: "Thu Phí",
      currentNumber: 0,
      announcementTemplate: "Mời số thứ tự {{number}} tới quầy Thu Phí."
    },
    khamDoan: {
      label: "Khám Đoàn",
      currentNumber: 0,
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

// Hàm tổng hợp giọng nói tiếng Việt
async function synthesizeVietnameseSpeech(text, options = {}) {
  const { execSync } = require("child_process");
  const ttsOutputPath = path.join(__dirname, "public", "tts_output.wav");
  const pythonPath = `C:\\Users\\Thinkpad X280\\AppData\\Local\\Programs\\Python\\Python311\\python.exe`;
  const bridgePath = path.join(__dirname, "tts_bridge.py");

  const voice = options.voice || "Bích Ngọc (Nữ - Miền Bắc)";

  try {
    // Chạy script bridge Python để tạo audio TTS chất lượng cao (VieNeu-TTS)
    // Lưu ý: Lần chạy đầu tiên có thể chậm do phải tải model
    execSync(`& "${pythonPath}" "${bridgePath}" "${text}" --output "${ttsOutputPath}" --voice "${voice}"`, {
      shell: "powershell",
      timeout: 30000 // Hết hạn sau 30 giây
    });

    if (fs.existsSync(ttsOutputPath)) {
      return fs.readFileSync(ttsOutputPath);
    }
    throw new Error("Không tìm thấy file output TTS");
  } catch (error) {
    console.error("VieNeu-TTS thất bại, đang chuyển sang Google TTS:", error);

    // Dự phòng sang Google TTS nếu VieNeu-TTS lỗi
    try {
      const googleTts = require("google-tts-api");
      const audioBase64 = await googleTts.getAudioBase64(text, {
        lang: "vi",
        slow: false,
        timeout: 15000
      });
      return Buffer.from(audioBase64, "base64");
    } catch (googleError) {
      console.error("Cả VieNeu-TTS và Google TTS đều thất bại:", googleError);
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

// API tăng số thứ tự
app.post("/api/increment", (req, res) => {
  const { streamKey } = req.body;

  if (!queueState.streams[streamKey]) {
    res.status(400).json({ message: "Luồng không hợp lệ." });
    return;
  }

  queueState.streams[streamKey].currentNumber += 1;
  writeState(queueState);
  broadcastState();
  res.json(queueState);
});

// API cập nhật trạng thái luồng cụ thể
app.post("/api/state", (req, res) => {
  const { streamKey, currentNumber, announcementTemplate } = req.body;
  const stream = queueState.streams[streamKey];

  if (!stream) {
    res.status(400).json({ message: "Luồng không hợp lệ." });
    return;
  }

  const nextNumber = Number.parseInt(currentNumber, 10);
  if (!Number.isInteger(nextNumber) || nextNumber < 0) {
    res.status(400).json({ message: "Số thứ tự không hợp lệ." });
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

// API gọi thông báo TTS (Dựa trên câu mẫu)
app.post("/api/announce", async (req, res) => {
  try {
    const { streamKey, voice } = req.body;
    const stream = queueState.streams[streamKey];

    if (!stream) {
      res.status(400).json({ message: "Luồng không hợp lệ." });
      return;
    }

    const text = buildAnnouncementText(stream.announcementTemplate, stream.currentNumber, stream.label);
    const audioBuffer = await synthesizeVietnameseSpeech(text, { voice });

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
    const { text, voice } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ message: "Nội dung thông báo không được để trống." });
      return;
    }

    const audioBuffer = await synthesizeVietnameseSpeech(text.trim(), { voice });

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
