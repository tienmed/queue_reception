const viewerGridElement = document.getElementById("viewerGrid");
const streamSelectorElement = document.getElementById("streamSelector");
const layoutButtons = Array.from(document.querySelectorAll("[data-layout]"));
const clockTimeElement = document.getElementById("clockTime");
const clockDateElement = document.getElementById("clockDate");
const viewerSocket = io();
const streamOrder = ["bhyt", "thuPhi", "khamDoan"];

let viewerState = { streams: {} };
let viewerLayout = "1";
let selectedStreams = ["bhyt"];

function formatNumber(value) {
  return String(value).padStart(3, "0");
}

function updateClock() {
  const now = new Date();
  clockTimeElement.textContent = now.toLocaleTimeString("vi-VN");
  clockDateElement.textContent = now.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function getVisibleLimit() {
  return viewerLayout === "2" ? 2 : 1;
}

function ensureValidSelection() {
  const availableStreams = streamOrder.filter((streamKey) => viewerState.streams[streamKey]);
  const visibleLimit = getVisibleLimit();
  let nextSelection = selectedStreams.filter((streamKey) => availableStreams.includes(streamKey));

  if (nextSelection.length === 0 && availableStreams.length > 0) {
    nextSelection = [availableStreams[0]];
  }

  while (nextSelection.length < visibleLimit && nextSelection.length < availableStreams.length) {
    const missingKey = availableStreams.find((streamKey) => !nextSelection.includes(streamKey));
    if (!missingKey) {
      break;
    }
    nextSelection.push(missingKey);
  }

  selectedStreams = nextSelection.slice(0, visibleLimit);
}

function renderStreamSelector() {
  ensureValidSelection();

  streamSelectorElement.innerHTML = streamOrder
    .filter((streamKey) => viewerState.streams[streamKey])
    .map((streamKey) => {
      const stream = viewerState.streams[streamKey];
      const checked = selectedStreams.includes(streamKey) ? "checked" : "";

      return `
        <label class="stream-option">
          <input type="checkbox" value="${streamKey}" ${checked} />
          <span>${stream.label}</span>
        </label>
      `;
    })
    .join("");

  streamSelectorElement.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const checkedKeys = Array.from(streamSelectorElement.querySelectorAll('input[type="checkbox"]:checked')).map(
        (item) => item.value
      );
      const visibleLimit = getVisibleLimit();

      if (checkedKeys.length === 0) {
        checkbox.checked = true;
        return;
      }

      if (checkedKeys.length > visibleLimit) {
        checkbox.checked = false;
        return;
      }

      selectedStreams = checkedKeys;
      renderViewer();
    });
  });
}

function renderViewer() {
  ensureValidSelection();
  viewerGridElement.className = `viewer-grid layout-${viewerLayout}`;
  viewerGridElement.innerHTML = selectedStreams
    .map((streamKey) => {
      const stream = viewerState.streams[streamKey];
      const counters = Object.values(stream.counters || {});
      const counterRows = counters
        .map(
          (counter) => `
            <div class="viewer-counter-row">
              <span class="viewer-counter-label">${counter.label}</span>
              <strong class="viewer-counter-number">${formatNumber(counter.currentNumber || 0)}</strong>
            </div>
          `
        )
        .join("");

      return `
        <article class="viewer-panel">
          <p class="eyebrow">Khu Tiếp Nhận</p>
          <p class="viewer-stream-label">${stream.label}</p>
          <div class="viewer-counter-list">${counterRows}</div>
          <p class="viewer-caption">Số thứ tự đang được gọi theo từng quầy</p>
        </article>
      `;
    })
    .join("");
}

function updateViewer(state) {
  viewerState = state;
  renderStreamSelector();
  renderViewer();
}

layoutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    viewerLayout = button.dataset.layout;
    layoutButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderStreamSelector();
    renderViewer();
  });
});

viewerSocket.on("queue:update", updateViewer);

fetch("/api/state")
  .then((response) => response.json())
  .then(updateViewer)
  .catch(() => {
    updateViewer({ streams: {} });
  });

updateClock();
setInterval(updateClock, 1000);
