const currentNumberElement = document.getElementById("currentNumber");
const activeStreamLabelElement = document.getElementById("activeStreamLabel");
const activeCounterLabelElement = document.getElementById("activeCounterLabel");
const incrementButton = document.getElementById("incrementButton");
const announceButton = document.getElementById("announceButton");
const setNumberBtn = document.getElementById("setNumberBtn");
const setNumberInput = document.getElementById("setNumberInput");
const saveTemplateBtn = document.getElementById("saveTemplateBtn");
const announcementTemplateInput = document.getElementById("announcementTemplate");
const previewTextElement = document.getElementById("previewText");
const streamTabsElement = document.getElementById("streamTabs");
const counterTabsElement = document.getElementById("counterTabs");
const voiceSelect = document.getElementById("voiceSelect");
const speedRange = document.getElementById("speedRange");
const customText = document.getElementById("customText");
const customAnnounceButton = document.getElementById("customAnnounceButton");
const refreshAudioBtn = document.getElementById("refreshAudioBtn");
const speedLevelSpan = document.getElementById("speedLevel");

const controlSocket = io();
const streamOrder = ["bhyt", "thuPhi", "khamDoan"];

let state = { streams: {} };
let activeStreamKey = "bhyt";
let activeCounterKey = "quay1";

function formatNumber(value) {
  return String(value).padStart(3, "0");
}

function getActiveStream() {
  return state.streams[activeStreamKey];
}

function getActiveCounter() {
  return getActiveStream()?.counters?.[activeCounterKey];
}

function buildAnnouncementText(template, number, label) {
  const safeTemplate = template && template.trim() ? template.trim() : "Mời khách hàng số {{number}} tới quầy {{quay}}.";
  return safeTemplate
    .replaceAll("{{number}}", formatNumber(number))
    .replaceAll("{{quay}}", label || "tiếp nhận");
}

async function fetchAnnouncementAudio(refreshCache = false) {
  const response = await fetch("/api/announce", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      streamKey: activeStreamKey,
      counterKey: activeCounterKey,
      voice: voiceSelect.value,
      refreshCache: refreshCache
    })
  });

  if (!response.ok) {
    throw new Error("Yêu cầu TTS thất bại");
  }

  return response.blob();
}

function playAudioBlob(audioBlob) {
  return new Promise((resolve) => {
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Áp dụng tốc độ từ slider (1=0.8, 2=0.9, 3=1.0, 4=1.1, 5=1.2)
    const speedMap = { "1": 0.8, "2": 0.9, "3": 1.0, "4": 1.1, "5": 1.2 };
    audio.playbackRate = speedMap[speedRange.value] || 1.0;

    function done() {
      URL.revokeObjectURL(audioUrl);
      resolve();
    }

    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", done, { once: true });

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(done);
    }
  });
}

function renderStreamTabs() {
  streamTabsElement.innerHTML = streamOrder
    .filter((streamKey) => state.streams[streamKey])
    .map((streamKey) => {
      const stream = state.streams[streamKey];
      const activeClass = streamKey === activeStreamKey ? "active" : "";
      return `<button class="segment-btn ${activeClass}" type="button" data-stream-key="${streamKey}">${stream.label}</button>`;
    })
    .join("");

  streamTabsElement.querySelectorAll("[data-stream-key]").forEach((button) => {
    button.addEventListener("click", () => {
      activeStreamKey = button.dataset.streamKey;
      activeCounterKey = "quay1";
      renderControl();
    });
  });
}

function renderCounterTabs() {
  const activeStream = getActiveStream();
  const counters = activeStream?.counters || {};

  counterTabsElement.innerHTML = Object.entries(counters)
    .map(([counterKey, counter]) => {
      const activeClass = counterKey === activeCounterKey ? "active" : "";
      return `<button class="segment-btn ${activeClass}" type="button" data-counter-key="${counterKey}">${counter.label}</button>`;
    })
    .join("");

  counterTabsElement.querySelectorAll("[data-counter-key]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCounterKey = button.dataset.counterKey;
      renderControl();
    });
  });
}

function renderControl() {
  const activeStream = getActiveStream();
  const activeCounter = getActiveCounter();
  if (!activeStream) {
    return;
  }

  activeStreamLabelElement.textContent = activeStream.label;
  activeCounterLabelElement.textContent = activeCounter?.label || "Quầy";
  currentNumberElement.textContent = formatNumber(activeCounter?.currentNumber || 0);
  setNumberInput.value = String(activeStream.nextNumber || 0);
  announcementTemplateInput.value = activeStream.announcementTemplate;
  previewTextElement.textContent = `Xem trước: ${buildAnnouncementText(
    activeStream.announcementTemplate,
    activeCounter?.currentNumber || 0,
    activeCounter?.label || activeStream.label
  )}`;
  renderStreamTabs();
  renderCounterTabs();
}

function updateControl(nextState) {
  state = nextState;

  if (!state.streams[activeStreamKey]) {
    activeStreamKey = streamOrder.find((streamKey) => state.streams[streamKey]) || "bhyt";
  }

  if (!state.streams[activeStreamKey]?.counters?.[activeCounterKey]) {
    activeCounterKey = "quay1";
  }

  renderControl();
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Yêu cầu không thành công");
  }

  return response.json();
}

async function incrementNumber() {
  if (incrementButton.disabled) return;
  incrementButton.disabled = true;

  try {
    const response = await fetch("/api/increment-and-announce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        streamKey: activeStreamKey,
        counterKey: activeCounterKey,
        voice: voiceSelect.value
      })
    });

    if (!response.ok) {
      throw new Error("Yêu cầu tăng số + phát loa thất bại");
    }

    const audioBlob = await response.blob();
    await playAudioBlob(audioBlob);
  } catch (err) {
    console.error("Lỗi tăng số và phát loa:", err);
    // Trích xuất thông báo lỗi từ server nếu có
    let msg = "Không thể tăng số hoặc phát loa. Vui lòng thử lại.";
    if (err.message && err.message.includes("Yêu cầu")) {
      msg = `${err.message}. Vui lòng kiểm tra lại hệ thống loa hoặc log server.`;
    }
    window.alert(msg);
  } finally {
    incrementButton.disabled = false;
  }
}

async function playSampleThenSpeak(refreshCache = false) {
  if (announceButton.disabled || (refreshCache && refreshAudioBtn.disabled)) return;

  if (refreshCache) refreshAudioBtn.disabled = true;
  announceButton.disabled = true;

  try {
    try {
      const audioBlob = await fetchAnnouncementAudio(refreshCache);
      await playAudioBlob(audioBlob);
    } catch (err) {
      console.error("TTS lỗi, thử dùng API trình duyệt:", err);
      await speakBrowserside();
    }
  } finally {
    announceButton.disabled = false;
    if (refreshCache) refreshAudioBtn.disabled = false;
  }
}

function speakBrowserside() {
  return new Promise((resolve) => {
    const activeStream = getActiveStream();
    const activeCounter = getActiveCounter();
    const synth = window.speechSynthesis;

    if (!activeStream || !activeCounter || !synth) {
      resolve();
      return;
    }

    const text = buildAnnouncementText(
      activeStream.announcementTemplate,
      activeCounter.currentNumber,
      activeCounter.label
    );
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "vi-VN";
    utterance.onend = resolve;
    utterance.onerror = resolve;

    const voices = synth.getVoices();
    const vietnameseVoice = voices.find((voice) => voice.lang === "vi-VN");
    if (vietnameseVoice) {
      utterance.voice = vietnameseVoice;
    }

    // Áp dụng tốc độ trình duyệt mẫu (1=0.8, 2=0.9, 3=1.0, 4=1.1, 5=1.2)
    const speedMap = { "1": 0.8, "2": 0.9, "3": 1.0, "4": 1.1, "5": 1.2 };
    utterance.rate = speedMap[speedRange.value] || 1.0;

    synth.cancel();
    synth.speak(utterance);
  });
}

async function handleSetNumber() {
  const activeStream = getActiveStream();
  const nextValue = Number.parseInt(setNumberInput.value, 10);

  if (!activeStream || !Number.isInteger(nextValue) || nextValue < 0) {
    window.alert("Vui lòng nhập số hợp lệ.");
    return;
  }

  try {
    await postJson("/api/state", {
      streamKey: activeStreamKey,
      counterKey: activeCounterKey,
      currentNumber: nextValue,
      announcementTemplate: announcementTemplateInput.value
    });
  } catch (_error) {
    window.alert("Không cập nhật được số.");
  }
}

async function saveAnnouncementTemplate() {
  const activeStream = getActiveStream();
  if (!activeStream) return;

  try {
    await postJson("/api/state", {
      streamKey: activeStreamKey,
      counterKey: activeCounterKey,
      currentNumber: activeStream.nextNumber,
      announcementTemplate: announcementTemplateInput.value
    });
    window.alert("Đã lưu mẫu câu thành công!");
  } catch (_error) {
    window.alert("Không lưu được mẫu câu.");
  }
}

async function announceCustomText() {
  const text = customText.value;
  if (!text || !text.trim()) {
    window.alert("Vui lòng nhập nội dung cần phát loa.");
    return;
  }

  customAnnounceButton.disabled = true;
  try {
    const response = await fetch("/api/announce-custom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text.trim(),
        counterKey: activeCounterKey,
        voice: voiceSelect.value
      })
    });

    if (!response.ok) throw new Error("Custom TTS failed");

    const audioBlob = await response.blob();
    await playAudioBlob(audioBlob);
  } catch (error) {
    console.error("Lỗi phát loa tùy chỉnh:", error);
    window.alert("Không thể phát loa nội dung này.");
  } finally {
    customAnnounceButton.disabled = false;
  }
}

incrementButton.addEventListener("click", incrementNumber);
announceButton.addEventListener("click", playSampleThenSpeak);
customAnnounceButton.addEventListener("click", announceCustomText);
setNumberBtn.addEventListener("click", handleSetNumber);
saveTemplateBtn.addEventListener("click", saveAnnouncementTemplate);
refreshAudioBtn.addEventListener("click", () => playSampleThenSpeak(true));

speedRange.addEventListener("input", () => {
  if (speedLevelSpan) {
    speedLevelSpan.textContent = speedRange.value;
  }
});

announcementTemplateInput.addEventListener("input", () => {
  const activeStream = getActiveStream();
  if (!activeStream) return;

  previewTextElement.textContent = `Xem trước: ${buildAnnouncementText(
    announcementTemplateInput.value,
    getActiveCounter()?.currentNumber || 0,
    getActiveCounter()?.label || activeStream.label
  )}`;
});

controlSocket.on("queue:update", updateControl);

fetch("/api/state")
  .then((response) => response.json())
  .then(updateControl)
  .catch(() => {
    updateControl({ streams: {} });
  });
