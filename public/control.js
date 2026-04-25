const currentNumberElement = document.getElementById("currentNumber");
const activeStreamLabelElement = document.getElementById("activeStreamLabel");
const activeCounterLabelElement = document.getElementById("activeCounterLabel");
const incrementButton = document.getElementById("incrementButton");
const decrementButton = document.getElementById("decrementButton");
const announceButton = document.getElementById("announceButton");
const setNumberBtn = document.getElementById("setNumberBtn");
const setNumberInput = document.getElementById("setNumberInput");
const streamTabsElement = document.getElementById("streamTabs");
const counterTabsElement = document.getElementById("counterTabs");
const voiceSelect = document.getElementById("voiceSelect");
const customText = document.getElementById("customText");
const customAnnounceButton = document.getElementById("customAnnounceButton");

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

async function fetchAnnouncementAudio() {
  const response = await fetch("/api/announce", {
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
    let serverMessage = "Yêu cầu TTS thất bại";
    try {
      const errorData = await response.json();
      if (errorData.message) serverMessage = errorData.message;
    } catch (_) { /* ignore parse error */ }
    const err = new Error(serverMessage);
    err.serverMessage = serverMessage;
    throw err;
  }

  return response.blob();
}

function playChime() {
  return new Promise((resolve) => {
    const chime = new Audio("/assets/sounds/notification.wav");
    chime.addEventListener("ended", () => resolve(), { once: true });
    chime.addEventListener("error", () => resolve(), { once: true });
    chime.play().catch(() => resolve());
  });
}

function playAudioBlob(audioBlob) {
  return new Promise((resolve) => {
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.playbackRate = 1.0;

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

async function playSequence(audioBlob) {
  await playChime();
  // Small delay for natural feel
  await new Promise(r => setTimeout(r, 400));
  await playAudioBlob(audioBlob);
}

function renderStreamTabs() {
  streamTabsElement.innerHTML = streamOrder
    .filter((streamKey) => state.streams[streamKey])
    .map((streamKey) => {
      const stream = state.streams[streamKey];
      const activeClass = streamKey === activeStreamKey ? "active" : "";
      return `<button class="tab-btn ${activeClass}" type="button" data-stream-key="${streamKey}">${stream.label}</button>`;
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
      return `<button class="tab-btn ${activeClass}" type="button" data-counter-key="${counterKey}">${counter.label}</button>`;
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
  incrementButton.classList.add("loading");
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
      throw new Error("Yêu cầu tăng số thất bại");
    }

    const audioBlob = await response.blob();
    await playSequence(audioBlob);
  } catch (err) {
    console.error("Lỗi tăng số:", err);
    window.alert(err.message || "Không thể tăng số.");
  } finally {
    incrementButton.classList.remove("loading");
    incrementButton.disabled = false;
  }
}

async function decrementNumber() {
  if (decrementButton.disabled) return;
  decrementButton.disabled = true;

  try {
    const response = await fetch("/api/decrement-and-announce", {
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
      throw new Error("Yêu cầu giảm số thất bại");
    }

    const audioBlob = await response.blob();
    await playSequence(audioBlob);
  } catch (err) {
    console.error("Lỗi giảm số:", err);
    window.alert(err.message || "Không thể giảm số.");
  } finally {
    decrementButton.disabled = false;
  }
}

async function playSampleThenSpeak() {
  if (announceButton.disabled) return;
  announceButton.disabled = true;

  try {
    const audioBlob = await fetchAnnouncementAudio();
    await playSequence(audioBlob);
  } catch (err) {
    console.error("Lỗi phát loa:", err);
    const msg = err.serverMessage || "Không thể phát loa.";
    window.alert(msg);
  } finally {
    announceButton.disabled = false;
  }
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
      currentNumber: nextValue
    });
  } catch (_error) {
    window.alert("Không cập nhật được số.");
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
        voice: voiceSelect.value
      })
    });

    if (!response.ok) throw new Error("Custom TTS failed");

    const audioBlob = await response.blob();
    await playSequence(audioBlob);
  } catch (error) {
    console.error("Lỗi phát loa tùy chỉnh:", error);
    window.alert("Không thể phát loa nội dung này.");
  } finally {
    customAnnounceButton.disabled = false;
  }
}

const announceStartButton = document.getElementById("announceStartButton");

async function announceStart() {
  announceStartButton.disabled = true;
  try {
    const response = await fetch("/api/announce-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        voice: voiceSelect.value
      })
    });

    if (!response.ok) throw new Error("Start announcement failed");

    const audioBlob = await response.blob();
    await playSequence(audioBlob);
  } catch (error) {
    console.error("Lỗi phát loa đầu ca:", error);
    window.alert("Không thể phát loa thông báo đầu ca.");
  } finally {
    announceStartButton.disabled = false;
  }
}

incrementButton.addEventListener("click", incrementNumber);
decrementButton.addEventListener("click", decrementNumber);
announceButton.addEventListener("click", playSampleThenSpeak);
setNumberBtn.addEventListener("click", handleSetNumber);
customAnnounceButton.addEventListener("click", announceCustomText);
announceStartButton.addEventListener("click", announceStart);

controlSocket.on("queue:update", updateControl);

fetch("/api/state")
  .then((response) => response.json())
  .then(updateControl)
  .catch(() => {
    updateControl({ streams: {} });
  });

