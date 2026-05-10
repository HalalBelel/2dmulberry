// Lightweight browser save. In production Capacitor, swap this for @capacitor/preferences.
const SAVE_KEY = 'mulberry-fire-kit-v1';
const HINT_COST = 2;
const SKIP_COST = 4;
const AUTO_HINT_THRESHOLDS = [12000, 24000, 38000];
const BOARD_SCALE_MIN = 0.88;
const BOARD_SCALE_MAX = 1.25;

// Item definitions drive both rendering and puzzle validation.
const ITEM_DEFS = {
  branch: {
    id: 'branch',
    label: 'Curved Branch',
    meta: 'Flexible mulberry bow frame',
    texture: 'texture-branch',
  },
  spindle: {
    id: 'spindle',
    label: 'Straight Spindle',
    meta: 'Dry spindle shaft',
    texture: 'texture-wood',
  },
  fibre: {
    id: 'fibre',
    label: 'Fibre Strip',
    meta: 'Cord for the bow drill',
    texture: 'texture-fibre',
  },
  stone: {
    id: 'stone',
    label: 'River Stone',
    meta: 'A stable heat ring',
    texture: 'texture-stone',
  },
  tinder: {
    id: 'tinder',
    label: 'Dry Tinder',
    meta: 'Catches the first ember',
    texture: 'texture-tinder',
  },
  bowDrill: {
    id: 'bowDrill',
    label: 'Bow Drill',
    meta: 'Use it to start fire',
    texture: 'texture-bowdrill',
  },
};

// Hotspots model the harvest-first puzzle loop from the source game: environment → tool part → next tool.
const HOTSPOTS = [
  {
    id: 'bush',
    label: 'Mulberry bush',
    className: 'hotspot-bush',
    steps: [
      { itemId: 'branch', count: 1, currency: 1, text: 'You bend a curved branch free.' },
      { itemId: 'spindle', count: 1, currency: 1, text: 'A straight spindle shaft comes away cleanly.' },
      { itemId: 'fibre', count: 1, currency: 1, text: 'You strip a length of mulberry fibre.' },
    ],
    rewardSummary: 'Contains the curved branch, spindle, and fibre strip.',
  },
  {
    id: 'stones',
    label: 'Stone patch',
    className: 'hotspot-stones',
    steps: [
      { itemId: 'stone', count: 1, currency: 1, text: 'You collect a flat river stone.' },
      { itemId: 'stone', count: 1, currency: 1, text: 'A second stone will steady the pit.' },
      { itemId: 'stone', count: 1, currency: 1, text: 'A third stone completes the ring.' },
    ],
    rewardSummary: 'Three stones for the fire pit.',
  },
  {
    id: 'litter',
    label: 'Leaf litter',
    className: 'hotspot-litter',
    steps: [
      { itemId: 'tinder', count: 1, currency: 1, text: 'You gather a bundle of dry tinder.' },
    ],
    rewardSummary: 'Dry tinder for ignition.',
  },
];

// Sockets accept a single matching item and validate by overlap on drop.
const SLOT_DEFS = {
  slotBowBranch: { accept: 'branch' },
  slotBowSpindle: { accept: 'spindle' },
  slotBowFibre: { accept: 'fibre' },
  slotStoneA: { accept: 'stone' },
  slotStoneB: { accept: 'stone' },
  slotStoneC: { accept: 'stone' },
  slotTinder: { accept: 'tinder' },
};

const ui = {
  objectiveText: document.getElementById('objectiveText'),
  boardStateText: document.getElementById('boardStateText'),
  currencyValue: document.getElementById('currencyValue'),
  hotspotList: document.getElementById('hotspotList'),
  inventoryList: document.getElementById('inventoryList'),
  inventoryDropZone: document.getElementById('inventoryDropZone'),
  logList: document.getElementById('logList'),
  dragLayer: document.getElementById('dragLayer'),
  toast: document.getElementById('toast'),
  boardArea: document.getElementById('boardArea'),
  boardInner: document.getElementById('boardInner'),
  bowCraftNotice: document.getElementById('bowCraftNotice'),
  fireZone: document.querySelector('.fire-zone'),
  ignitionZone: document.getElementById('ignitionZone'),
  hintButton: document.getElementById('hintButton'),
  skipButton: document.getElementById('skipButton'),
  resetButton: document.getElementById('resetButton'),
};

let toastTimeout = null;
let autoHintStageShown = 0;

const gesture = {
  pointers: new Map(),
  pinching: false,
  startDistance: 0,
  startScale: 1,
};

let drag = null;

// All mutable level state lives here so saving and restoring is straightforward.
function createInitialState() {
  return {
    version: 1,
    currency: 0,
    inventory: {
      branch: 0,
      spindle: 0,
      fibre: 0,
      stone: 0,
      tinder: 0,
      bowDrill: 0,
    },
    placed: {
      slotBowBranch: null,
      slotBowSpindle: null,
      slotBowFibre: null,
      slotStoneA: null,
      slotStoneB: null,
      slotStoneC: null,
      slotTinder: null,
    },
    hotspotProgress: {
      bush: 0,
      stones: 0,
      litter: 0,
    },
    crafted: {
      bowDrill: false,
    },
    complete: false,
    assistsUsed: 0,
    lastInteractionAt: Date.now(),
    boardScale: 1,
    log: [
      'Level loaded. Start by tapping the environment hotspots.',
    ],
  };
}

function restoreState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return createInitialState();
    const parsed = JSON.parse(raw);
    const base = createInitialState();
    return {
      ...base,
      ...parsed,
      inventory: { ...base.inventory, ...(parsed.inventory || {}) },
      placed: { ...base.placed, ...(parsed.placed || {}) },
      hotspotProgress: { ...base.hotspotProgress, ...(parsed.hotspotProgress || {}) },
      crafted: { ...base.crafted, ...(parsed.crafted || {}) },
      log: Array.isArray(parsed.log) && parsed.log.length ? parsed.log.slice(0, 8) : base.log,
    };
  } catch (error) {
    console.error('Failed to restore save:', error);
    return createInitialState();
  }
}

let state = restoreState();

function saveState() {
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function resetState() {
  localStorage.removeItem(SAVE_KEY);
  state = createInitialState();
  autoHintStageShown = 0;
  logEvent('Progress reset.');
  render();
}

function logEvent(text) {
  state.log.unshift(text);
  state.log = state.log.slice(0, 8);
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add('visible');
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    ui.toast.classList.remove('visible');
  }, 2400);
}

function markInteraction() {
  state.lastInteractionAt = Date.now();
  autoHintStageShown = 0;
}

function countPlaced(itemId) {
  return Object.values(state.placed).filter(value => value === itemId).length;
}

function totalOwned(itemId) {
  return (state.inventory[itemId] || 0) + countPlaced(itemId);
}

function addItem(itemId, amount = 1) {
  state.inventory[itemId] = (state.inventory[itemId] || 0) + amount;
}

function removeItem(itemId, amount = 1) {
  state.inventory[itemId] = Math.max(0, (state.inventory[itemId] || 0) - amount);
}

function buildHotspotMarkup() {
  return HOTSPOTS.map((hotspot) => {
    const progress = state.hotspotProgress[hotspot.id] || 0;
    const remaining = Math.max(0, hotspot.steps.length - progress);
    const depletedClass = remaining === 0 ? 'is-depleted' : '';
    return `
      <button class="hotspot ${hotspot.className} ${depletedClass}" data-hotspot-id="${hotspot.id}">
        <div class="hotspot-title">
          <strong>${hotspot.label}</strong>
          <small>${remaining > 0 ? `${remaining} find${remaining === 1 ? '' : 's'} left` : 'depleted'}</small>
        </div>
        <div class="reward-text">${hotspot.rewardSummary}</div>
      </button>
    `;
  }).join('');
}

function renderInventory() {
  const entries = Object.entries(state.inventory)
    .filter(([, count]) => count > 0)
    .map(([itemId, count]) => ({ ...ITEM_DEFS[itemId], count }));

  if (!entries.length) {
    ui.inventoryList.innerHTML = '<p class="item-meta">No loose parts yet. Harvest the environment first.</p>';
    return;
  }

  ui.inventoryList.innerHTML = entries.map((item) => `
    <button class="inventory-item ${item.texture}" data-drag-source="inventory" data-item-id="${item.id}">
      <span class="item-label">${item.label}</span>
      <span class="item-meta">${item.meta} · x${item.count}</span>
    </button>
  `).join('');
}

function renderSlots() {
  Object.entries(SLOT_DEFS).forEach(([slotId, slotDef]) => {
    const slotEl = document.querySelector(`[data-slot-id="${slotId}"]`);
    if (!slotEl) return;
    const itemId = state.placed[slotId];

    slotEl.classList.toggle('has-item', Boolean(itemId));
    slotEl.innerHTML = itemId
      ? `
        <div class="slot-token ${ITEM_DEFS[itemId].texture} placed-token" data-drag-source="slot" data-slot-id="${slotId}" data-item-id="${itemId}">
          <span class="item-label">${ITEM_DEFS[itemId].label}</span>
        </div>
      `
      : `<span>${slotLabel(slotId, slotDef.accept)}</span>`;
  });
}

function slotLabel(slotId, accept) {
  const labels = {
    slotBowBranch: 'Curved branch',
    slotBowSpindle: 'Spindle',
    slotBowFibre: 'Fibre strip',
    slotStoneA: 'Stone',
    slotStoneB: 'Stone',
    slotStoneC: 'Stone',
    slotTinder: 'Tinder',
  };
  return labels[slotId] || ITEM_DEFS[accept].label;
}

// Recipe resolution: once all bow-drill parts are placed, collapse them into one crafted tool.
function craftBowDrillIfReady() {
  if (state.crafted.bowDrill) return false;
  const ready = state.placed.slotBowBranch === 'branch'
    && state.placed.slotBowSpindle === 'spindle'
    && state.placed.slotBowFibre === 'fibre';

  if (!ready) return false;

  state.placed.slotBowBranch = null;
  state.placed.slotBowSpindle = null;
  state.placed.slotBowFibre = null;
  state.crafted.bowDrill = true;
  addItem('bowDrill', 1);
  logEvent('Bow drill assembled. It can now ignite the fire pit.');
  showToast('Bow drill assembled.');
  return true;
}

function isFirePitReady() {
  return state.placed.slotStoneA === 'stone'
    && state.placed.slotStoneB === 'stone'
    && state.placed.slotStoneC === 'stone'
    && state.placed.slotTinder === 'tinder';
}

// Final interaction for this sample level. Later levels would turn this output into the next crafting resource.
function igniteFire() {
  if (state.complete || !state.crafted.bowDrill || !isFirePitReady()) return false;
  state.complete = true;
  state.currency += 3;
  state.assistsUsed += 0;
  logEvent('Fire lit. The next production step is unlocked: drying and charcoal.');
  showToast('Level complete. Fire is lit.');
  return true;
}

function getCurrentObjective() {
  if (totalOwned('branch') < 1) {
    return {
      id: 'harvest-branch',
      text: 'Tap the Mulberry bush to find a curved branch.',
      hint: [
        'Start at the Mulberry bush on the left.',
        'Keep tapping the bush until it yields a curved branch.',
        'The first bush reward is the curved branch needed for the bow drill frame.',
      ],
      highlight: ['[data-hotspot-id="bush"]'],
    };
  }

  if (totalOwned('spindle') < 1) {
    return {
      id: 'harvest-spindle',
      text: 'Tap the Mulberry bush again to harvest a straight spindle.',
      hint: [
        'The bush still hides another useful part.',
        'Tap the Mulberry bush again for the spindle.',
        'You need the spindle before the bow drill can be assembled.',
      ],
      highlight: ['[data-hotspot-id="bush"]'],
    };
  }

  if (totalOwned('fibre') < 1) {
    return {
      id: 'harvest-fibre',
      text: 'Tap the Mulberry bush once more for a fibre strip.',
      hint: [
        'One last harvest remains in the bush.',
        'Tap the bush again to strip mulberry fibre.',
        'The fibre strip becomes the bow string in this level.',
      ],
      highlight: ['[data-hotspot-id="bush"]'],
    };
  }

  if (totalOwned('stone') < 3) {
    return {
      id: 'harvest-stones',
      text: 'Tap the Stone patch until you have three stones.',
      hint: [
        'The fire pit needs a full stone ring.',
        'Tap the Stone patch until you collect all three stones.',
        'You still need more stones for the fire pit sockets.',
      ],
      highlight: ['[data-hotspot-id="stones"]'],
    };
  }

  if (totalOwned('tinder') < 1) {
    return {
      id: 'harvest-tinder',
      text: 'Tap the Leaf litter to collect dry tinder.',
      hint: [
        'The fire pit still has nothing to catch the spark.',
        'Tap the Leaf litter hotspot for a tinder bundle.',
        'Dry tinder belongs in the middle fire-pit socket.',
      ],
      highlight: ['[data-hotspot-id="litter"]'],
    };
  }

  const missingFireSlots = ['slotStoneA', 'slotStoneB', 'slotStoneC', 'slotTinder'].filter(slotId => !state.placed[slotId]);
  if (missingFireSlots.length) {
    const slotId = missingFireSlots[0];
    return {
      id: `place-${slotId}`,
      text: 'Drag the harvested parts onto the fire-pit sockets.',
      hint: [
        'Overlap the matching part with the glowing socket on the board.',
        `Start with the highlighted ${slotLabel(slotId)} socket on the fire pit.`,
        `If you changed your mind, drag a placed part back to the Inventory tray.`,
      ],
      highlight: [`[data-slot-id="${slotId}"]`, '#inventoryDropZone'],
    };
  }

  if (!state.crafted.bowDrill) {
    const missingBowSlots = ['slotBowBranch', 'slotBowSpindle', 'slotBowFibre'].filter(slotId => !state.placed[slotId]);
    const slotId = missingBowSlots[0];
    return {
      id: `build-bow-${slotId || 'ready'}`,
      text: 'Assemble the bow drill on the left rig.',
      hint: [
        'The bow drill uses the branch, spindle, and fibre strip.',
        `Overlap the correct part with the highlighted bow-drill socket.`,
        'Once all three bow-drill sockets are filled, the tool is crafted automatically.',
      ],
      highlight: slotId ? [`[data-slot-id="${slotId}"]`] : [],
    };
  }

  if (!state.complete) {
    const highlights = ['#ignitionZone'];
    if (state.inventory.bowDrill > 0) highlights.push('[data-item-id="bowDrill"][data-drag-source="inventory"]');
    return {
      id: 'ignite',
      text: 'Drag the completed bow drill onto the ignition zone to light the fire.',
      hint: [
        'The fire pit is ready for ignition.',
        'Drag the bow drill from the inventory tray into the ignition zone.',
        'The completed fire unlocks the next loop: drying wood and making charcoal.',
      ],
      highlight: highlights,
    };
  }

  return {
    id: 'complete',
    text: 'Fire lit. Next unlock: Drying Rack.',
    hint: [
      'Level complete.',
      'Level complete.',
      'Level complete.',
    ],
    highlight: ['.fire-zone'],
  };
}

function applyHint(stage, spendCurrency) {
  const objective = getCurrentObjective();
  const clampedStage = Math.max(1, Math.min(3, stage));

  if (spendCurrency) {
    if (state.currency < HINT_COST) {
      showToast(`Need ${HINT_COST} mulberries for a manual hint.`);
      return false;
    }
    state.currency -= HINT_COST;
    logEvent(`Hint used for ${HINT_COST} mulberries.`);
  }

  clearHighlights();
  objective.highlight.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.classList.add('pulse');
    });
  });

  const message = objective.hint[clampedStage - 1] || objective.text;
  showToast(message);
  return true;
}

function clearHighlights() {
  document.querySelectorAll('.pulse').forEach((element) => element.classList.remove('pulse'));
  document.querySelectorAll('.drop-highlight').forEach((element) => element.classList.remove('drop-highlight'));
}

function runStepSkip() {
  if (state.currency < SKIP_COST) {
    showToast(`Need ${SKIP_COST} mulberries to skip a step.`);
    return;
  }

  const objective = getCurrentObjective();
  state.currency -= SKIP_COST;
  state.assistsUsed += 1;
  markInteraction();

  switch (objective.id) {
    case 'harvest-branch':
      addItem('branch', 1);
      state.hotspotProgress.bush = Math.max(state.hotspotProgress.bush, 1);
      break;
    case 'harvest-spindle':
      addItem('spindle', 1);
      state.hotspotProgress.bush = Math.max(state.hotspotProgress.bush, 2);
      break;
    case 'harvest-fibre':
      addItem('fibre', 1);
      state.hotspotProgress.bush = Math.max(state.hotspotProgress.bush, 3);
      break;
    case 'harvest-stones':
      addItem('stone', 1);
      state.hotspotProgress.stones = Math.min(3, (state.hotspotProgress.stones || 0) + 1);
      break;
    case 'harvest-tinder':
      addItem('tinder', 1);
      state.hotspotProgress.litter = Math.max(state.hotspotProgress.litter, 1);
      break;
    default:
      if (objective.id.startsWith('place-')) {
        const slotId = objective.id.replace('place-', '');
        const required = SLOT_DEFS[slotId]?.accept;
        if (required && !state.inventory[required]) addItem(required, 1);
        if (required) {
          removeItem(required, 1);
          state.placed[slotId] = required;
        }
      } else if (objective.id.startsWith('build-bow-')) {
        const slotId = objective.id.replace('build-bow-', '');
        const required = SLOT_DEFS[slotId]?.accept;
        if (required) {
          if (!state.inventory[required]) addItem(required, 1);
          removeItem(required, 1);
          state.placed[slotId] = required;
        }
        craftBowDrillIfReady();
      } else if (objective.id === 'ignite') {
        igniteFire();
      }
      break;
  }

  logEvent(`Step skip used for ${SKIP_COST} mulberries.`);
  showToast('Skipped one objective step.');
  render();
}

// Re-render the small DOM scene whenever state changes.
function render() {
  ui.hotspotList.innerHTML = buildHotspotMarkup();
  renderInventory();
  renderSlots();

  const objective = getCurrentObjective();
  ui.objectiveText.textContent = objective.text;
  ui.currencyValue.textContent = String(state.currency);
  ui.boardStateText.textContent = state.complete
    ? 'Fire lit. The next level can pivot into drying and charcoal.'
    : `Board zoom: ${Math.round(state.boardScale * 100)}% · Pinch to inspect.`;

  ui.bowCraftNotice.textContent = state.crafted.bowDrill
    ? 'Bow drill complete. Drag it from the inventory tray to the ignition zone.'
    : 'Place the branch, spindle, and fibre strip to craft the bow drill.';
  ui.bowCraftNotice.classList.toggle('finished', state.crafted.bowDrill);
  ui.fireZone.classList.toggle('is-lit', state.complete);
  ui.ignitionZone.classList.toggle('disabled', !state.crafted.bowDrill || !isFirePitReady() || state.complete);
  ui.logList.innerHTML = state.log.map(message => `<li>${message}</li>`).join('');
  ui.boardInner.style.setProperty('--board-scale', String(state.boardScale));
  document.documentElement.style.setProperty('--board-scale', String(state.boardScale));

  saveState();
}

function harvestHotspot(hotspotId) {
  const hotspot = HOTSPOTS.find(entry => entry.id === hotspotId);
  if (!hotspot || state.complete) return;

  const progress = state.hotspotProgress[hotspotId] || 0;
  const reward = hotspot.steps[progress];
  if (!reward) {
    showToast('Nothing else useful here right now.');
    return;
  }

  addItem(reward.itemId, reward.count);
  state.currency += reward.currency;
  state.hotspotProgress[hotspotId] = progress + 1;
  markInteraction();
  logEvent(reward.text);
  showToast(`${ITEM_DEFS[reward.itemId].label} harvested.`);
  render();
}

// Dragging uses a floating avatar and overlap-based target selection instead of pixel-perfect snapping.
function startDrag(pointerEvent, itemId, sourceKind, sourceMeta) {
  if (drag || state.complete) return;

  const def = ITEM_DEFS[itemId];
  const avatar = document.createElement('div');
  avatar.className = `drag-avatar ${def.texture}`;
  avatar.innerHTML = `
    <span class="item-label">${def.label}</span>
    <span class="item-meta">${def.meta}</span>
  `;
  ui.dragLayer.appendChild(avatar);

  drag = {
    pointerId: pointerEvent.pointerId,
    itemId,
    sourceKind,
    sourceMeta,
    avatar,
    x: pointerEvent.clientX,
    y: pointerEvent.clientY,
  };

  moveDrag(pointerEvent.clientX, pointerEvent.clientY);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function moveDrag(clientX, clientY) {
  if (!drag) return;
  drag.x = clientX;
  drag.y = clientY;
  drag.avatar.style.left = `${clientX}px`;
  drag.avatar.style.top = `${clientY}px`;
  previewDropTarget();
}

function onPointerMove(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  moveDrag(event.clientX, event.clientY);
}

function onPointerUp(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;

  const bestTarget = getBestDropTarget(drag.avatar.getBoundingClientRect());
  clearHighlights();

  let handled = false;
  if (bestTarget) {
    const target = bestTarget.el;
    handled = handleDrop(target);
  }

  if (!handled) {
    showToast('That part does not belong there yet.');
  }

  finishDrag();
  render();
}

function handleDrop(target) {
  const targetKind = target.dataset.kind || 'slot';

  if (targetKind === 'inventory-return' && drag.sourceKind === 'slot') {
    const { slotId } = drag.sourceMeta;
    state.placed[slotId] = null;
    addItem(drag.itemId, 1);
    logEvent(`${ITEM_DEFS[drag.itemId].label} returned to the inventory tray.`);
    markInteraction();
    return true;
  }

  if (targetKind === 'ignition') {
    if (drag.itemId !== 'bowDrill' || !state.crafted.bowDrill || !isFirePitReady()) {
      return false;
    }
    markInteraction();
    return igniteFire();
  }

  const slotId = target.dataset.slotId;
  if (!slotId || SLOT_DEFS[slotId].accept !== drag.itemId || state.placed[slotId]) {
    return false;
  }

  if (drag.sourceKind === 'inventory') {
    if ((state.inventory[drag.itemId] || 0) <= 0) return false;
    removeItem(drag.itemId, 1);
  }

  if (drag.sourceKind === 'slot') {
    state.placed[drag.sourceMeta.slotId] = null;
  }

  state.placed[slotId] = drag.itemId;
  markInteraction();
  logEvent(`${ITEM_DEFS[drag.itemId].label} placed on the board.`);
  craftBowDrillIfReady();
  return true;
}

function finishDrag() {
  if (!drag) return;
  drag.avatar.remove();
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
}

function previewDropTarget() {
  if (!drag) return;
  clearHighlights();
  const bestTarget = getBestDropTarget(drag.avatar.getBoundingClientRect());
  if (bestTarget) {
    bestTarget.el.classList.add('drop-highlight');
  }
}

// Choose the target with the strongest overlap ratio. This feels forgiving on touch screens.
function getBestDropTarget(dragRect) {
  const targets = Array.from(document.querySelectorAll('.drop-target')).filter((el) => {
    if (el.id === 'ignitionZone' && (!state.crafted.bowDrill || !isFirePitReady() || state.complete)) return false;
    if (el.dataset.slotId && state.placed[el.dataset.slotId]) return false;
    return true;
  });

  let best = null;
  let bestScore = 0;
  targets.forEach((target) => {
    const rect = target.getBoundingClientRect();
    const overlapWidth = Math.max(0, Math.min(dragRect.right, rect.right) - Math.max(dragRect.left, rect.left));
    const overlapHeight = Math.max(0, Math.min(dragRect.bottom, rect.bottom) - Math.max(dragRect.top, rect.top));
    const overlapArea = overlapWidth * overlapHeight;
    if (!overlapArea) return;
    const referenceArea = Math.min(dragRect.width * dragRect.height, rect.width * rect.height);
    const score = overlapArea / referenceArea;
    if (score > bestScore) {
      bestScore = score;
      best = target;
    }
  });

  return bestScore >= 0.18 ? { el: best, score: bestScore } : null;
}

function onGlobalPointerDown(event) {
  const inventoryButton = event.target.closest('[data-drag-source="inventory"]');
  if (inventoryButton) {
    event.preventDefault();
    startDrag(event, inventoryButton.dataset.itemId, 'inventory', {});
    return;
  }

  const slotToken = event.target.closest('[data-drag-source="slot"]');
  if (slotToken) {
    event.preventDefault();
    startDrag(event, slotToken.dataset.itemId, 'slot', { slotId: slotToken.dataset.slotId });
  }
}

function onHotspotClick(event) {
  const hotspotButton = event.target.closest('[data-hotspot-id]');
  if (hotspotButton) {
    harvestHotspot(hotspotButton.dataset.hotspotId);
  }
}

// Optional multi-touch: pinch to zoom the board for close inspection on smaller phones.
function trackBoardGesture(event) {
  if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
  if (event.target.closest('[data-drag-source], [data-hotspot-id], .action-button')) return;

  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (gesture.pointers.size === 2) {
    const [a, b] = [...gesture.pointers.values()];
    gesture.pinching = true;
    gesture.startDistance = Math.hypot(b.x - a.x, b.y - a.y);
    gesture.startScale = state.boardScale;
  }
}

function updateBoardGesture(event) {
  if (!gesture.pointers.has(event.pointerId)) return;
  gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (!gesture.pinching || gesture.pointers.size < 2 || drag) return;

  const [a, b] = [...gesture.pointers.values()];
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  if (!gesture.startDistance) return;

  const nextScale = clamp(gesture.startScale * (distance / gesture.startDistance), BOARD_SCALE_MIN, BOARD_SCALE_MAX);
  state.boardScale = Math.round(nextScale * 100) / 100;
  ui.boardInner.style.setProperty('--board-scale', String(state.boardScale));
  document.documentElement.style.setProperty('--board-scale', String(state.boardScale));
}

function releaseBoardGesture(event) {
  if (!gesture.pointers.has(event.pointerId)) return;
  gesture.pointers.delete(event.pointerId);
  if (gesture.pointers.size < 2) {
    gesture.pinching = false;
    gesture.startDistance = 0;
    saveState();
    render();
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Progressive hints appear after inactivity without charging the player.
function tickAutoHints() {
  const objective = getCurrentObjective();
  if (objective.id === 'complete' || drag) return;

  const idleFor = Date.now() - state.lastInteractionAt;
  const nextStage = AUTO_HINT_THRESHOLDS.findIndex(threshold => idleFor < threshold) + 1;
  const stage = nextStage === 0 ? 3 : nextStage - 1;

  if (stage > autoHintStageShown) {
    autoHintStageShown = stage;
    applyHint(stage, false);
  }
}

ui.hintButton.addEventListener('click', () => {
  markInteraction();
  if (applyHint(3, true)) render();
});

ui.skipButton.addEventListener('click', () => {
  runStepSkip();
});

ui.resetButton.addEventListener('click', () => {
  resetState();
});

document.addEventListener('click', onHotspotClick);
document.addEventListener('pointerdown', onGlobalPointerDown);
ui.boardArea.addEventListener('pointerdown', trackBoardGesture);
ui.boardArea.addEventListener('pointermove', updateBoardGesture);
ui.boardArea.addEventListener('pointerup', releaseBoardGesture);
ui.boardArea.addEventListener('pointercancel', releaseBoardGesture);
ui.boardArea.addEventListener('pointerleave', releaseBoardGesture);

document.addEventListener('visibilitychange', () => saveState());
window.addEventListener('beforeunload', saveState);
window.setInterval(tickAutoHints, 1000);

render();
