/* eslint-env browser */
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const logEl = document.getElementById("log");

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

function updateUI(state) {
  statusDot.className = "status-dot " + (state.connected ? (state.active ? "active" : "idle") : "disconnected");

  if (!state.connected) {
    statusText.textContent = "Disconnected from native host";
  } else if (state.active) {
    statusText.textContent = "AI is currently controlling the browser";
  } else {
    statusText.textContent = "Connected - Idle";
  }

  if (state.recentActions && state.recentActions.length > 0) {
    logEl.innerHTML = state.recentActions.map(entry => `
      <div class="log-entry">
        <span class="action">${entry.action}</span>
        <span class="time">${formatTime(entry.time)}</span>
      </div>
    `).join("");
  } else {
    logEl.innerHTML = '<div class="empty">No recent AI activity</div>';
  }
}

browser.runtime.sendMessage({ type: "getStatus" }).then(updateUI).catch(() => {
  updateUI({ connected: false, active: false, recentActions: [] });
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "statusUpdate") {
    updateUI(msg.state);
  }
});
