const viewerGridElement = document.getElementById("viewerGrid");
const streamSelectorElement = document.getElementById("streamSelector");
const layoutButtons = Array.from(document.querySelectorAll("[data-layout]"));
const clockTimeElement = document.getElementById("clockTime");
const clockDateElement = document.getElementById("clockDate");
const viewerSocket = io();

// Metadata cho các luồng
const streamOrder = ["bhyt", "thuPhi", "khamDoan"];

// Trạng thái hiển thị của Viewer
let viewerState = { streams: {} };
let viewerLayout = "1"; // "1", "2", "3"
let selectedSlots = [{ streamKey: "bhyt", counterKey: "quay1" }];

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
  return parseInt(viewerLayout, 10);
}

/**
 * Đảm bảo số lượng slot được hiển thị khớp với layout (1, 2, hoặc 3)
 */
function ensureValidSelection() {
  const visibleLimit = getVisibleLimit();

  // Thu thập tất cả các quầy hiện có từ server state
  const availableOptions = [];
  streamOrder.forEach(sk => {
    const s = viewerState.streams[sk];
    if (s && s.counters) {
      Object.keys(s.counters).forEach(ck => {
        availableOptions.push({ streamKey: sk, counterKey: ck });
      });
    }
  });

  // Lọc bỏ những slot không còn tồn tại trên server
  selectedSlots = selectedSlots.filter(slot =>
    availableOptions.some(opt => opt.streamKey === slot.streamKey && opt.counterKey === slot.counterKey)
  );

  // Nếu không có slot nào hợp lệ, chọn slot đầu tiên mặc định
  if (selectedSlots.length === 0 && availableOptions.length > 0) {
    selectedSlots = [availableOptions[0]];
  }

  // Bổ sung thêm slot nếu layout yêu cầu hiển thị nhiều hơn hiện tại
  while (selectedSlots.length < visibleLimit && selectedSlots.length < availableOptions.length) {
    const nextOpt = availableOptions.find(opt =>
      !selectedSlots.some(s => s.streamKey === opt.streamKey && s.counterKey === opt.counterKey)
    );
    if (!nextOpt) break;
    selectedSlots.push(nextOpt);
  }

  // Giới hạn lại theo layout
  selectedSlots = selectedSlots.slice(0, visibleLimit);
}

function renderStreamSelector() {
  ensureValidSelection();
  const visibleLimit = getVisibleLimit();

  let html = "";
  streamOrder.forEach(sk => {
    const s = viewerState.streams[sk];
    if (!s || !s.counters) return;

    html += `<div class="selector-group">`;
    Object.keys(s.counters).forEach(ck => {
      const counter = s.counters[ck];
      const isSelected = selectedSlots.some(slot => slot.streamKey === sk && slot.counterKey === ck);
      const checked = isSelected ? "checked" : "";

      html += `
        <label class="stream-option">
          <input type="checkbox" data-stream="${sk}" data-counter="${ck}" ${checked} />
          <span>${s.label} - ${counter.label}</span>
        </label>
      `;
    });
    html += `</div>`;
  });

  streamSelectorElement.innerHTML = html;

  // Xử lý sự kiện khi người dùng chọn/bỏ chọn quầy
  streamSelectorElement.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const checkedInputs = Array.from(streamSelectorElement.querySelectorAll('input[type="checkbox"]:checked'));

      if (checkedInputs.length === 0) {
        checkbox.checked = true;
        return;
      }

      // Nếu vượt quá giới hạn cột, bỏ chọn cái cũ nhất (hoặc ngăn cản)
      if (checkedInputs.length > visibleLimit) {
        checkbox.checked = false;
        return;
      }

      selectedSlots = checkedInputs.map(input => ({
        streamKey: input.dataset.stream,
        counterKey: input.dataset.counter
      }));

      renderViewer();
    });
  });
}

function renderViewer() {
  ensureValidSelection();
  viewerGridElement.className = `viewer-grid layout-${viewerLayout}`;

  viewerGridElement.innerHTML = selectedSlots
    .map((slot, index) => {
      const stream = viewerState.streams[slot.streamKey];
      const counter = stream.counters[slot.counterKey];

      return `
        <article class="viewer-panel color-slot-${index + 1}">
          <p class="eyebrow">Tiếp Nhận</p>
          <div class="viewer-stream-container">
            <p class="viewer-stream-label">${stream.label}</p>
            <p class="viewer-counter-label">${counter.label}</p>
          </div>
          
          <div class="viewer-main-number">
             <strong class="viewer-number">${formatNumber(counter.currentNumber || 0)}</strong>
          </div>

          <p class="viewer-caption">Số thứ tự đang được gọi</p>
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
