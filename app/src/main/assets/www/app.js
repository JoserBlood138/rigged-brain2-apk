const $ = (id) => document.getElementById(id);

const screens = {
  home: $("screen-home"),
  levels: $("screen-levels"),
  game: $("screen-game"),
  win: $("screen-win")
};

const stage = $("stage");
const inventoryEl = $("inventory");
const toast = $("toast");

const STORAGE_KEY = "rigged-brain-v4-5-no-inventory-save";
const defaultSave = { unlockedLevel: 1, lastLevel: 1, stars: {}, coins: 0, brains: 0 };
let save = loadSave();
let state = getFreshState();

function getFreshState(levelIndex = 0, level = null) {
  return {
    currentLevelIndex: levelIndex,
    level,
    objects: new Map(),
    inventory: [],
    selectedInventoryItem: null,
    drag: null,
    mistakes: 0,
    hintsUsed: 0,
    solved: false,
    penalties: 0
  };
}

const ACTIONS = {
  wake_cat() {
    setObjectAsset("cat", "assets/objects/bedroom/cat_awake.png");
    const curtain = state.objects.get("curtain");
    if (curtain) curtain.el.classList.add("used");
    flashStage();
    completeLevel("El gato despertó sin tocarlo.");
  },

  turn_on_sign() {
    setObjectAsset("sign", "assets/objects/city/neuro_cafe_sign_on.png");
    const power = state.objects.get("power_box");
    if (power) power.el.classList.add("pop");
    flashStage();
    completeLevel("El letrero se encendió sin tocar directamente el interruptor.");
  },

  ignite_campfire() {
    setObjectAsset("logs_target", "assets/objects/camping/campfire_on.png");
    flashStage();
    completeLevel("Encendiste los leños usando el Fire Starter, sin tocar el fuego directamente.");
  }
};

function loadSave() {
  try {
    return { ...structuredClone(defaultSave), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return structuredClone(defaultSave);
  }
}

function writeSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
  syncStats();
}

function syncStats() {
  const totalStars = Object.values(save.stars || {}).reduce((a, b) => a + Number(b || 0), 0);
  $("home-stars").textContent = totalStars;
  $("home-brains").textContent = save.brains;
  $("home-coins").textContent = save.coins;
  $("level-total-stars").textContent = totalStars;
  $("game-stars-total").textContent = totalStars;
  $("game-brains-total").textContent = save.brains;
}

function showScreen(name) {
  Object.values(screens).forEach(screen => screen.classList.remove("active"));
  screens[name].classList.add("active");
  if (name === "levels") renderLevelSelect();
  syncStats();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function vibrate(ms = 30) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function playTone(type = "tap") {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = playTone.ctx || (playTone.ctx = new AudioContext());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    const freq = type === "success" ? 720 : type === "wrong" ? 130 : 340;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(type === "success" ? 980 : freq * 1.2, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.start(now);
    osc.stop(now + 0.18);
  } catch {}
}

function renderLevelSelect() {
  const grid = $("level-grid");
  grid.innerHTML = "";
  RIGGED_LEVELS.forEach((level, index) => {
    const unlocked = level.id <= save.unlockedLevel;
    const btn = document.createElement("button");
    btn.className = "level-tile " + (unlocked ? "unlocked" : "locked") + (level.id === save.lastLevel ? " current" : "");
    const stars = save.stars[level.id] || 0;
    btn.innerHTML = `<span>${unlocked ? String(level.id).padStart(2, "0") : "🔒"}</span><small>${"★".repeat(stars)}${"☆".repeat(3 - stars)}</small>`;
    btn.addEventListener("click", () => {
      if (!unlocked) {
        wrongGlobal("Nivel bloqueado. Completa el anterior.");
        return;
      }
      startLevel(index);
    });
    grid.appendChild(btn);
  });
}

function startLastOrFirst() {
  const targetId = Math.min(save.lastLevel || 1, save.unlockedLevel || 1);
  const index = RIGGED_LEVELS.findIndex(level => level.id === targetId);
  startLevel(index >= 0 ? index : 0);
}

function startLevel(index) {
  const level = RIGGED_LEVELS[index];
  if (!level) return;
  state = getFreshState(index, level); state.inventory = []; state.selectedInventoryItem = null;
  save.lastLevel = level.id;
  writeSave();
  $("level-label").textContent = `NIVEL ${String(level.id).padStart(2, "0")}`;
  $("objective-text").textContent = level.objective;
  $("hint-count").textContent = "3";
  $("star-strip").textContent = "★★★";
  stage.innerHTML = "";
  stage.className = `stage ${level.sceneClass || ""}`;
  renderObjects(level.objects || []);
  renderInventory();
  showScreen("game");
}

function renderObjects(objects) {
  objects.forEach(config => {
    const el = document.createElement("div");
    el.id = config.id;
    el.className = getObjectClass(config);
    renderObjectContent(el, config);
    setBox(el, config);
    const gameObject = { ...config, el, startX: config.x, startY: config.y };
    state.objects.set(config.id, gameObject);
    stage.appendChild(el);
    bindObjectEvents(gameObject);
  });
}

function getObjectClass(config) {
  const classes = ["obj"];
  classes.push(config.asset ? "asset" : "panel");
  if (config.hintClass) classes.push(config.hintClass);
  if (config.hidden) classes.push("hidden-target");
  if (config.ghost) classes.push("ghost");
  if (["draggable", "collectible"].includes(config.kind)) classes.push("pulse");
  return classes.join(" ");
}

function renderObjectContent(el, config) {
  el.innerHTML = "";
  if (config.asset) {
    const img = document.createElement("img");
    img.src = config.asset;
    img.alt = config.name || config.id;
    img.draggable = false;
    el.appendChild(img);
  } else {
    el.textContent = config.text || config.name || config.id;
  }
}

function setObjectAsset(objectId, src) {
  const obj = state.objects.get(objectId);
  if (!obj) return;
  obj.asset = src;
  renderObjectContent(obj.el, obj);
  obj.el.classList.add("pop");
}

function setBox(el, config) {
  el.style.left = config.x + "%";
  el.style.top = config.y + "%";
  el.style.width = (config.w || 80) + "px";
  el.style.height = (config.h || 80) + "px";
  el.style.transform = "translate(-50%, -50%)";
}

function bindObjectEvents(obj) {
  obj.el.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (state.solved) return;
    playTone("tap");

    if (state.selectedInventoryItem) {
      tryUseInventoryOnTarget(state.selectedInventoryItem, obj);
      return;
    }

    if (obj.kind === "collectible") {
      showToast("En esta versión no hay inventario: arrastra los objetos directamente.");
      return;
    }

    if (obj.kind === "draggable") {
      startDrag(event, obj, "stage");
      return;
    }

    if (obj.kind === "tap" || obj.kind === "target") {
      if (obj.kind === "target" && !obj.wrong && !obj.action) {
        showToast("Ese es un punto de uso, necesitas usar otro objeto aquí.");
        return;
      }
      if (obj.action) runAction(obj.action);
      else wrong(obj.wrong || "Eso no funciona aquí.", obj.el);
    }
  });
}

function startDrag(event, obj, source) {
  let offsetX = obj.el.offsetWidth / 2;
  let offsetY = obj.el.offsetHeight / 2;
  const rect = obj.el.getBoundingClientRect();
  if (source !== "inventory" && rect.width > 0) {
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
  }

  state.drag = { obj, source, pointerId: event.pointerId, offsetX, offsetY };
  obj.el.setPointerCapture?.(event.pointerId);
  obj.el.classList.add("dragging");
  obj.el.style.zIndex = "99";

  if (source === "inventory") {
    stage.appendChild(obj.el);
    obj.el.className = "obj asset dragging key inv-drag";
    obj.el.style.width = "82px";
    obj.el.style.height = "82px";
    placeDraggedObject(event, obj);
  }
}

function placeDraggedObject(event, obj) {
  const stageRect = stage.getBoundingClientRect();
  const x = event.clientX - stageRect.left - state.drag.offsetX + obj.el.offsetWidth / 2;
  const y = event.clientY - stageRect.top - state.drag.offsetY + obj.el.offsetHeight / 2;
  const px = Math.max(0, Math.min(stageRect.width, x)) / stageRect.width * 100;
  const py = Math.max(0, Math.min(stageRect.height, y)) / stageRect.height * 100;
  obj.el.style.left = px + "%";
  obj.el.style.top = py + "%";
  obj.el.style.transform = "translate(-50%, -50%)";
}

stage.addEventListener("pointermove", event => {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  placeDraggedObject(event, state.drag.obj);
});

stage.addEventListener("pointerup", event => {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  finishDrag();
});

function finishDrag() {
  const drag = state.drag;
  if (!drag) return;
  drag.obj.el.classList.remove("dragging");
  drag.obj.el.style.zIndex = "";
  const target = findDropTarget(drag.obj);
  if (drag.source === "inventory") handleInventoryDrop(drag.obj, target);
  else handleStageDrop(drag.obj, target);
  state.drag = null;
}

function findDropTarget(dragObj) {
  let found = null;
  for (const obj of state.objects.values()) {
    if (obj.id === dragObj.id) continue;
    if (["target", "tap", "panel"].includes(obj.kind) && overlap(dragObj.el, obj.el, 0.22)) {
      found = obj;
    }
  }
  return found;
}

function handleStageDrop(obj, target) {
  if (target && obj.target === target.id) {
    if (obj.action) runAction(obj.action);
    return;
  }
  wrong(obj.wrong || "Eso no encaja ahí.", obj.el);
  resetStageObject(obj);
}

function handleInventoryDrop(item, target) {
  if (!target) {
    item.el.remove();
    renderInventory();
    showToast("El objeto volvió al inventario.");
    return;
  }
  const use = (state.level.inventoryUses || []).find(rule => rule.item === item.id && rule.target === target.id);
  if (!use) {
    item.el.remove();
    renderInventory();
    wrong(item.wrongUse || `"${item.name}" no funciona con eso.`, target.el);
    return;
  }
  showToast(use.message || "Objeto usado correctamente.");
  removeInventoryItem(item.id);
  state.selectedInventoryItem = null;
  item.el.remove();
  runAction(use.action);
}

function tryUseInventoryOnTarget(item, target) {
  const use = (state.level.inventoryUses || []).find(rule => rule.item === item.id && rule.target === target.id);
  if (!use) {
    wrong(item.wrongUse || `"${item.name}" no funciona con eso.`, target.el);
    state.selectedInventoryItem = null;
    renderInventory();
    return;
  }
  showToast(use.message || "Objeto usado correctamente.");
  removeInventoryItem(item.id);
  state.selectedInventoryItem = null;
  runAction(use.action);
}

function collectObject(obj) {
  if (state.inventory.length >= 4) {
    wrong("Inventario lleno.", obj.el);
    return;
  }
  obj.el.classList.add("used");
  state.inventory.push({ id: obj.id, name: obj.name || obj.id, asset: obj.asset, text: obj.text || "?", wrongUse: obj.wrongUse });
  showToast(`${obj.name || obj.id} agregado al inventario.`);
  playTone("success");
  vibrate(35);
  renderInventory();
}

function renderInventory() {
  inventoryEl.innerHTML = "";
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const item = state.inventory[i];
    if (item) {
      if (state.selectedInventoryItem?.id === item.id) slot.classList.add("selected");
      const itemEl = document.createElement("div");
      itemEl.className = "inv-item";
      itemEl.title = item.name;
      if (item.asset) {
        const img = document.createElement("img");
        img.src = item.asset;
        img.alt = item.name;
        img.draggable = false;
        itemEl.appendChild(img);
      } else {
        itemEl.textContent = item.text;
      }
      itemEl.addEventListener("click", () => {
        state.selectedInventoryItem = state.selectedInventoryItem?.id === item.id ? null : item;
        renderInventory();
        showToast(state.selectedInventoryItem ? `Seleccionado: ${item.name}` : "Objeto deseleccionado.");
      });
      itemEl.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.stopPropagation();
        const dragEl = document.createElement("div");
        renderObjectContent(dragEl, item);
        const dragObj = { ...item, kind: "inventory", el: dragEl, slotIndex: i };
        startDrag(event, dragObj, "inventory");
      });
      slot.appendChild(itemEl);
    }
    inventoryEl.appendChild(slot);
  }
  $("hint-count").textContent = String(Math.max(0, 3 - state.hintsUsed));
  const stars = calculateStars();
  $("star-strip").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
}

function removeInventoryItem(itemId) {
  state.inventory = state.inventory.filter(item => item.id !== itemId);
  if (state.selectedInventoryItem?.id === itemId) state.selectedInventoryItem = null;
  renderInventory();
}

function resetStageObject(obj) {
  obj.el.style.left = obj.startX + "%";
  obj.el.style.top = obj.startY + "%";
  obj.el.classList.remove("dragging");
}

function overlap(a, b, threshold = 0.28) {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const x = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
  const y = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
  const area = x * y;
  const minArea = Math.min(ar.width * ar.height, br.width * br.height);
  return minArea > 0 && area / minArea >= threshold;
}

function runAction(actionName) {
  const fn = ACTIONS[actionName];
  if (fn) fn();
  else console.warn("Acción no encontrada:", actionName);
}

function wrong(message, element = stage) {
  state.mistakes++;
  if (state.mistakes === 3) state.penalties++;
  element.classList.remove("shake");
  void element.offsetWidth;
  element.classList.add("shake");
  showToast(message || "No era por ahí.");
  playTone("wrong");
  vibrate(45);
  renderInventory();
}

function wrongGlobal(message) {
  showToast(message);
  playTone("wrong");
  vibrate(35);
}

function useHint() {
  if (state.solved || !state.level) return;
  const hint = (state.level.hints || [])[state.hintsUsed];
  if (!hint) {
    showToast("Ya no quedan pistas para este nivel.");
    return;
  }
  state.hintsUsed++;
  if (state.hintsUsed === 1) state.penalties++;
  if (state.hintsUsed >= 3) state.penalties = Math.max(state.penalties, 2);
  showToast(hint);
  renderInventory();
}

function calculateStars() {
  return Math.max(1, 3 - state.penalties);
}

function completeLevel(summary) {
  if (state.solved) return;
  state.solved = true;
  const level = state.level;
  const stars = calculateStars();
  save.stars[level.id] = Math.max(save.stars[level.id] || 0, stars);
  save.unlockedLevel = Math.max(save.unlockedLevel || 1, Math.min(RIGGED_LEVELS.length, level.id + 1));
  save.lastLevel = Math.min(RIGGED_LEVELS.length, level.id + 1);
  save.coins += level.rewards?.coins || 0;
  save.brains += level.rewards?.brains || 0;
  writeSave();
  $("win-stars").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
  $("win-coins").textContent = level.rewards?.coins || 0;
  $("win-brains").textContent = level.rewards?.brains || 0;
  $("win-summary").textContent = summary || "Objetivo completado.";
  playTone("success");
  vibrate(90);
  setTimeout(() => showScreen("win"), 450);
}

function flashStage() {
  stage.animate([{ filter: "brightness(1)" }, { filter: "brightness(1.35)" }, { filter: "brightness(1)" }], { duration: 450, easing: "ease-out" });
}

function resetSave() {
  if (!confirm("¿Borrar progreso de la demo?")) return;
  localStorage.removeItem(STORAGE_KEY);
  save = loadSave();
  syncStats();
  renderLevelSelect();
  showToast("Progreso reiniciado.");
}

$("btn-continue").addEventListener("click", startLastOrFirst);
$("btn-levels").addEventListener("click", () => showScreen("levels"));
$("btn-reset-save").addEventListener("click", resetSave);
$("btn-levels-back").addEventListener("click", () => showScreen("home"));
$("btn-game-back").addEventListener("click", () => showScreen("levels"));
$("btn-home-game").addEventListener("click", () => showScreen("home"));
$("btn-restart").addEventListener("click", () => startLevel(state.currentLevelIndex));
$("btn-hint").addEventListener("click", useHint);
$("btn-next").addEventListener("click", () => {
  const nextIndex = state.currentLevelIndex + 1;
  if (nextIndex >= RIGGED_LEVELS.length) showScreen("levels");
  else startLevel(nextIndex);
});
$("btn-win-retry").addEventListener("click", () => startLevel(state.currentLevelIndex));
$("btn-win-home").addEventListener("click", () => showScreen("home"));

window.addEventListener("pointerup", () => {
  if (!state.drag) return;
  if (state.drag.source === "inventory") {
    state.drag.obj.el.remove();
    renderInventory();
  } else {
    resetStageObject(state.drag.obj);
  }
  state.drag = null;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

syncStats();
renderLevelSelect();


// ---- V4.3 overrides ----
function overlapScore(a, b) {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const x = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
  const y = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
  const area = x * y;
  const minArea = Math.min(ar.width * ar.height, br.width * br.height);
  return minArea > 0 ? area / minArea : 0;
}

function findDropTarget(dragObj) {
  const intended = dragObj.target ? state.objects.get(dragObj.target) : null;
  if (intended && intended.el) {
    const intendedScore = overlapScore(dragObj.el, intended.el);
    if (intendedScore >= 0.08) return intended;
  }
  let best = null;
  let bestScore = 0;
  for (const obj of state.objects.values()) {
    if (obj.id === dragObj.id) continue;
    if (!["target", "tap", "panel"].includes(obj.kind)) continue;
    const score = overlapScore(dragObj.el, obj.el);
    if (score >= 0.08 && score > bestScore) {
      best = obj;
      bestScore = score;
    }
  }
  return best;
}

function handleStageDrop(obj, target) {
  if (target && obj.target === target.id) {
    if (obj.action) {
      runAction(obj.action);
      return;
    }
  }
  wrong(obj.wrong || "Eso no encaja ahí.", obj.el);
  resetStageObject(obj);
}


/* ===== V4.5 no-inventory overrides ===== */
function overlapScore(a, b) {
  const ar = a.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const x = Math.max(0, Math.min(ar.right, br.right) - Math.max(ar.left, br.left));
  const y = Math.max(0, Math.min(ar.bottom, br.bottom) - Math.max(ar.top, br.top));
  const area = x * y;
  const minArea = Math.min(ar.width * ar.height, br.width * br.height);
  return minArea > 0 ? area / minArea : 0;
}

function findDropTarget(dragObj) {
  const intended = dragObj.target ? state.objects.get(dragObj.target) : null;
  if (intended && intended.el && overlapScore(dragObj.el, intended.el) >= 0.06) {
    return intended;
  }

  let best = null;
  let bestScore = 0;
  for (const obj of state.objects.values()) {
    if (obj.id === dragObj.id) continue;
    if (!["target", "tap", "panel"].includes(obj.kind)) continue;
    const score = overlapScore(dragObj.el, obj.el);
    if (score >= 0.06 && score > bestScore) {
      best = obj;
      bestScore = score;
    }
  }
  return best;
}

function handleStageDrop(obj, target) {
  if (target && obj.target === target.id && obj.action) {
    runAction(obj.action);
    return;
  }
  wrong(obj.wrong || "Eso no encaja ahí.", obj.el);
  resetStageObject(obj);
}

function renderInventory() {
  inventoryEl.innerHTML = "";
  $("hint-count").textContent = String(Math.max(0, 3 - state.hintsUsed));
  const stars = calculateStars();
  $("star-strip").textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
}
