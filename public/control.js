const currentNumberElement = document.getElementById("currentNumber");
const activeStreamLabelElement = document.getElementById("activeStreamLabel");
const incrementButton = document.getElementById("incrementButton");
const announceButton = document.getElementById("announceButton");
const setNumberForm = document.getElementById("setNumberForm");
const setNumberInput = document.getElementById("setNumberInput");
const announcementForm = document.getElementById("announcementForm");
const announcementTemplateInput = document.getElementById("announcementTemplate");
const previewTextElement = document.getElementById("previewText");
const streamTabsElement = document.getElementById("streamTabs");

const controlSocket = io();
const streamOrder = ["bhyt", "thuPhi", "khamDoan"];

let state = { streams: {} };
let activeStreamKey = "bhyt";

function formatNumber(value) {
  return String(value).padStart(3, "0");
}

function getActiveStream() {
  return state.streams[activeStreamKey];
}

function buildAnnouncementText(template, number) {
  const safeTemplate = template && template.trim() ? template.trim() : "Moi so thu tu {{number}} toi quay tiep nhan.";
  return safeTemplate.replaceAll("{{number}}", formatNumber(number));
}

async function fetchAnnouncementAudio() {
  const response = await fetch("/api/announce", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ streamKey: activeStreamKey })
  });

  if (!response.ok) {
    throw new Error("TTS request failed");
  }

  return response.blob();
}

function playAudioBlob(audioBlob) {
  return new Promise((resolve) => {
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

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
      renderControl();
    });
  });
}

function renderControl() {
  const activeStream = getActiveStream();
  if (!activeStream) {
    return;
  }

  activeStreamLabelElement.textContent = activeStream.label;
  currentNumberElement.textContent = formatNumber(activeStream.currentNumber);
  setNumberInput.value = String(activeStream.currentNumber);
  announcementTemplateInput.value = activeStream.announcementTemplate;
  previewTextElement.textContent = `Xem truoc: ${buildAnnouncementText(
    activeStream.announcementTemplate,
    activeStream.currentNumber
  )}`;
  renderStreamTabs();
}

function updateControl(nextState) {
  state = nextState;

  if (!state.streams[activeStreamKey]) {
    activeStreamKey = streamOrder.find((streamKey) => state.streams[streamKey]) || "bhyt";
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
    throw new Error("Request failed");
  }

  return response.json();
}

async function incrementNumber() {
  incrementButton.disabled = true;

  try {
    await postJson("/api/increment", { streamKey: activeStreamKey });
  } finally {
    incrementButton.disabled = false;
  }
}

function speakCurrentAnnouncement() {
  return new Promise((resolve) => {
    const activeStream = getActiveStream();
    const synth = window.speechSynthesis;

    if (!activeStream || !synth) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(
      buildAnnouncementText(activeStream.announcementTemplate, activeStream.currentNumber)
    );
    utterance.lang = "vi-VN";
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onend = resolve;
    utterance.onerror = resolve;

    const voices = synth.getVoices();
    const vietnameseVoice = voices.find((voice) => voice.lang === "vi-VN");
    if (vietnameseVoice) {
      utterance.voice = vietnameseVoice;
    }

    synth.cancel();
    synth.speak(utterance);
  });
}

async function playSampleThenSpeak() {
  announceButton.disabled = true;

  try {
    const sampleAudio = new Audio("/audio/sample-announcement.mp3");

    await new Promise((resolve) => {
      let finished = false;

      function done() {
        if (!finished) {
          finished = true;
          resolve();
        }
      }

      sampleAudio.addEventListener("ended", done, { once: true });
      sampleAudio.addEventListener("error", done, { once: true });

      const playPromise = sampleAudio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch(done);
      }

      setTimeout(done, 5000);
    });

    try {
      const audioBlob = await fetchAnnouncementAudio();
      await playAudioBlob(audioBlob);
    } catch (_error) {
      await speakCurrentAnnouncement();
    }
  } finally {
    announceButton.disabled = false;
  }
}

async function setNumber(event) {
  event.preventDefault();

  const activeStream = getActiveStream();
  const nextValue = Number.parseInt(setNumberInput.value, 10);

  if (!activeStream || !Number.isInteger(nextValue) || nextValue < 0) {
    window.alert("Vui long nhap so hop le.");
    return;
  }

  try {
    await postJson("/api/state", {
      streamKey: activeStreamKey,
      currentNumber: nextValue,
      announcementTemplate: announcementTemplateInput.value
    });
  } catch (_error) {
    window.alert("Khong cap nhat duoc so.");
  }
}

async function saveAnnouncementTemplate(event) {
  event.preventDefault();

  const activeStream = getActiveStream();
  if (!activeStream) {
    return;
  }

  try {
    await postJson("/api/state", {
      streamKey: activeStreamKey,
      currentNumber: activeStream.currentNumber,
      announcementTemplate: announcementTemplateInput.value
    });
  } catch (_error) {
    window.alert("Khong luu duoc cau doc.");
  }
}

incrementButton.addEventListener("click", incrementNumber);
announceButton.addEventListener("click", playSampleThenSpeak);
setNumberForm.addEventListener("submit", setNumber);
announcementForm.addEventListener("submit", saveAnnouncementTemplate);
announcementTemplateInput.addEventListener("input", () => {
  const activeStream = getActiveStream();
  if (!activeStream) {
    return;
  }

  previewTextElement.textContent = `Xem truoc: ${buildAnnouncementText(
    announcementTemplateInput.value,
    activeStream.currentNumber
  )}`;
});
controlSocket.on("queue:update", updateControl);

fetch("/api/state")
  .then((response) => response.json())
  .then(updateControl)
  .catch(() => {
    updateControl({ streams: {} });
  });
