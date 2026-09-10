import ChevronsLeft from "https://unpkg.com/lucide@1.43.0/dist/esm/icons/chevrons-left.mjs";
import ChevronsRight from "https://unpkg.com/lucide@1.43.0/dist/esm/icons/chevrons-right.mjs";
import LoaderCircle from "https://unpkg.com/lucide@1.43.0/dist/esm/icons/loader-circle.mjs";
import Pause from "https://unpkg.com/lucide@1.43.0/dist/esm/icons/pause.mjs";
import Play from "https://unpkg.com/lucide@1.43.0/dist/esm/icons/play.mjs";

const eras = window.EPIC_CARS_ERAS ?? [];
let currentEraId = window.EPIC_CARS_DEFAULT_ERA_ID ?? eras[0]?.id;

const surface = document.querySelector("#surface");
const eraYears = document.querySelector(".era-years");
const eraButtons = document.querySelector(".era-buttons");
const tuneButton = document.querySelector(".tune-button");
const TUNING_LOOP_SRC = "./assets/audio/radio-tuning.mp3";
const RADIO_STREAMS_BY_ERA_ID = {
  pioneers: "https://cloudstream.rubinbroadcasting.com/kcea",
  "postwar-modernism": "https://pureplay.cdnstream1.com/6005_128.mp3",
  "space-age": "https://stream.radiocaroline.net/fb128/;",
  "wedge-era": "https://streams.80s80s.de/web/mp3-128/streams.80s80s.de/",
  "analog-future": "https://streams.90s90s.de/pop/mp3-128/streams.90s90s.de/",
  "new-millennium": "https://stream.antenne.de/2000er-hits/stream/mp3",
  "electric-age": "https://stream.antenne.de/2010er-hits/stream/mp3",
};
const CARD_ROTATIONS = [-12, -11, -10, -9, -8, -7, -6, -5, -4, -3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EDGE_DRAG_SCALE = 1.16;
const CENTER_DRAG_WIDTH_RATIO = 0.4;
const CENTER_DRAG_MAX_WIDTH = 600;
const FILTER_CLEARANCE = 112;
const WIDE_PHOTO_CARD_IDS = new Set(["recLYb1bX7ihQTTPs"]);
const IMAGE_PRELOAD_TIMEOUT = 15000;
const LAYOUT_BLEED_RATIO = 0;
const LAYOUT_JITTER_RATIO = 0.28;
const LAYOUT_MARGIN_X_RATIO = 0.05;
const LAYOUT_MARGIN_TOP_RATIO = 0;
const LAYOUT_MARGIN_BOTTOM_RATIO = 0.05;
let topZ = 0;
let active = null;
let isRadioLoading = false;
let isRadioPlaying = false;
let radioAttemptId = 0;
let tuningLoopStartToken = 0;
let viewportLayoutFrame = 0;
const layoutsByEraId = new Map();
const preloadedImageUrls = new Set();
const radio = new Audio();
radio.className = "tune-radio";
radio.preload = "none";
const tuningLoop = new Audio(TUNING_LOOP_SRC);
tuningLoop.className = "tune-loading-loop";
tuningLoop.loop = true;
tuningLoop.preload = "auto";
let isTuningLoopActive = false;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function randomRotationValue() {
  return CARD_ROTATIONS[Math.floor(Math.random() * CARD_ROTATIONS.length)];
}

function createRandomCardLayout(itemCount) {
  if (itemCount === 0) {
    return [];
  }

  const aspectRatio = window.innerWidth / Math.max(window.innerHeight, 1);
  const columns = Math.ceil(Math.sqrt(itemCount * aspectRatio));
  const rows = Math.ceil(itemCount / columns);
  const zOrder = shuffle([...Array(itemCount)].map((_, index) => index + 1));
  const cells = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({ column, row });
    }
  }

  return shuffle(cells)
    .slice(0, itemCount)
    .map((cell, index) => {
      const usableWidth = 1 + LAYOUT_BLEED_RATIO * 2;
      const usableHeight = 1 + LAYOUT_BLEED_RATIO * 2;
      const cellWidth = usableWidth / columns;
      const cellHeight = usableHeight / rows;
      const jitterX = randomBetween(-cellWidth, cellWidth) * LAYOUT_JITTER_RATIO;
      const jitterY = randomBetween(-cellHeight, cellHeight) * LAYOUT_JITTER_RATIO;
      const xRatio = -LAYOUT_BLEED_RATIO + (cell.column + 0.5) * cellWidth + jitterX;
      const yRatio = -LAYOUT_BLEED_RATIO + (cell.row + 0.5) * cellHeight + jitterY;

      return {
        xRatio: clamp(xRatio, -LAYOUT_BLEED_RATIO, 1 + LAYOUT_BLEED_RATIO),
        yRatio: clamp(yRatio, -LAYOUT_BLEED_RATIO, 1 + LAYOUT_BLEED_RATIO),
        rotation: randomRotationValue(),
        zIndex: zOrder[index],
      };
    });
}

function getCurrentEra() {
  return eras.find((era) => era.id === currentEraId) ?? eras[0] ?? { id: "", label: "", years: [], cars: [], symbols: [] };
}

function getEraItems(era) {
  return [
    ...era.cars.map((car) => ({ type: "car", item: car })),
    ...(era.symbols ?? []).map((symbol) => ({ type: "symbol", item: symbol })),
  ];
}

function getItemImageUrl(item) {
  return item.image ? `./assets/${item.image}` : "";
}

function getEraImageUrls(era) {
  return getEraItems(era).map(({ item }) => getItemImageUrl(item)).filter(Boolean);
}

function markImagesPreloaded(urls) {
  urls.forEach((url) => preloadedImageUrls.add(normaliseUrl(url)));
}

function waitForImageElement(image) {
  if (image.complete) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  });
}

function waitForRenderedImages(container) {
  const images = [...container.querySelectorAll("img")];

  if (images.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(images.map(waitForImageElement));
}

function waitForBackgroundTurn() {
  return new Promise((resolve) => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(resolve, { timeout: 750 });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

function preloadImageUrl(url) {
  const absoluteUrl = normaliseUrl(url);

  if (!absoluteUrl || preloadedImageUrls.has(absoluteUrl)) {
    return Promise.resolve();
  }

  preloadedImageUrls.add(absoluteUrl);

  return new Promise((resolve) => {
    const image = new Image();
    let isFinished = false;
    const finish = () => {
      if (isFinished) {
        return;
      }

      isFinished = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, IMAGE_PRELOAD_TIMEOUT);

    image.onload = finish;
    image.onerror = finish;
    image.src = url;
  });
}

async function preloadEraImagesInBackground() {
  for (const era of eras) {
    await waitForBackgroundTurn();

    for (const imageUrl of getEraImageUrls(era)) {
      await preloadImageUrl(imageUrl);
    }
  }
}

function preloadRemainingEraImagesAfterInitialRender(initialEra) {
  const initialEraUrls = getEraImageUrls(initialEra);

  waitForRenderedImages(surface).then(() => {
    markImagesPreloaded(initialEraUrls);
    preloadEraImagesInBackground();
  });
}

function getCurrentStreamUrl() {
  return RADIO_STREAMS_BY_ERA_ID[getCurrentEra().id] ?? "";
}

function normaliseUrl(url) {
  return url ? new URL(url, window.location.href).href : "";
}

function syncAppViewportHeight() {
  const visualHeight = window.visualViewport?.height;
  const height = Number.isFinite(visualHeight) && visualHeight > 0 ? visualHeight : window.innerHeight;

  if (!Number.isFinite(height) || height <= 0) {
    return;
  }

  document.documentElement.style.setProperty("--app-viewport-height", `${Math.round(height)}px`);
}

function scheduleViewportLayout() {
  if (viewportLayoutFrame) {
    return;
  }

  viewportLayoutFrame = requestAnimationFrame(() => {
    viewportLayoutFrame = 0;
    syncAppViewportHeight();
    layoutCards();
    scheduleTextFit();
  });
}

function createLucideSvg(iconNode, name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");

  Object.entries({
    xmlns: "http://www.w3.org/2000/svg",
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: `lucide lucide-${name}`,
    "aria-hidden": "true",
  }).forEach(([key, value]) => svg.setAttribute(key, value));

  iconNode.forEach(([tag, attrs]) => {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([key, value]) => child.setAttribute(key, value));
    svg.appendChild(child);
  });

  return svg;
}

function renderTuneIcon() {
  if (!tuneButton) {
    return;
  }

  const icon = isRadioLoading ? LoaderCircle : isRadioPlaying ? Pause : Play;
  const iconName = isRadioLoading ? "loader-circle" : isRadioPlaying ? "pause" : "play";
  const label = isRadioLoading ? "Loading radio" : isRadioPlaying ? "Pause radio" : "Play radio";

  tuneButton.replaceChildren(createLucideSvg(icon, iconName));
  tuneButton.classList.toggle("is-loading", isRadioLoading);
  tuneButton.dataset.state = isRadioLoading ? "loading" : isRadioPlaying ? "playing" : "idle";
  tuneButton.setAttribute("aria-label", label);
  tuneButton.setAttribute("aria-pressed", String(isRadioPlaying));
}

function randomiseTuningLoopStart(token) {
  const duration = tuningLoop.duration;

  if (Number.isFinite(duration) && duration > 0) {
    tuningLoop.currentTime = Math.random() * duration;
    return;
  }

  tuningLoop.addEventListener(
    "loadedmetadata",
    () => {
      if (!isTuningLoopActive || tuningLoopStartToken !== token || !Number.isFinite(tuningLoop.duration)) {
        return;
      }

      tuningLoop.currentTime = Math.random() * tuningLoop.duration;
    },
    { once: true },
  );
}

function startTuningLoop({ restart = false } = {}) {
  if (isTuningLoopActive && !restart) {
    return;
  }

  const token = ++tuningLoopStartToken;
  isTuningLoopActive = true;
  randomiseTuningLoopStart(token);
  tuningLoop.play().catch(() => {
    if (tuningLoopStartToken !== token) {
      return;
    }

    isTuningLoopActive = false;
  });
}

function stopTuningLoop() {
  if (!isTuningLoopActive && tuningLoop.paused) {
    return;
  }

  isTuningLoopActive = false;
  tuningLoopStartToken += 1;
  tuningLoop.pause();
  tuningLoop.currentTime = 0;
}

function syncTuningLoop() {
  if (isRadioLoading) {
    startTuningLoop();
    return;
  }

  stopTuningLoop();
}

function playCurrentStream() {
  const streamUrl = getCurrentStreamUrl();

  if (!streamUrl) {
    return;
  }

  const targetSrc = normaliseUrl(streamUrl);
  const attemptId = ++radioAttemptId;

  isRadioPlaying = true;
  isRadioLoading = true;
  renderTuneIcon();
  startTuningLoop({ restart: true });

  if (radio.src !== targetSrc) {
    radio.src = streamUrl;
  }

  radio.play().catch(() => {
    if (radioAttemptId !== attemptId) {
      return;
    }

    isRadioPlaying = false;
    isRadioLoading = false;
    renderTuneIcon();
    syncTuningLoop();
  });
}

function pauseCurrentStream() {
  radioAttemptId += 1;
  radio.pause();
  isRadioLoading = false;
  isRadioPlaying = false;
  renderTuneIcon();
  syncTuningLoop();
}

function toggleRadio() {
  if (isRadioPlaying) {
    pauseCurrentStream();
    return;
  }

  playCurrentStream();
}

function syncRadioWithEra() {
  if (!isRadioPlaying) {
    return;
  }

  playCurrentStream();
}

function markRadioPlaying() {
  if (!isRadioPlaying) {
    return;
  }

  isRadioLoading = false;
  renderTuneIcon();
  syncTuningLoop();
}

function markRadioLoading() {
  if (!isRadioPlaying) {
    return;
  }

  isRadioLoading = true;
  renderTuneIcon();
  syncTuningLoop();
}

function markRadioFailed() {
  isRadioLoading = false;
  isRadioPlaying = false;
  renderTuneIcon();
  syncTuningLoop();
}

function getEraLayout(era) {
  if (!layoutsByEraId.has(era.id)) {
    layoutsByEraId.set(era.id, createRandomCardLayout(getEraItems(era).length));
  }

  return layoutsByEraId.get(era.id);
}

function initialiseEraLayouts() {
  eras.forEach((era) => {
    getEraLayout(era);
  });
}

function getCardLayoutArea(bounds, cardWidth, cardHeight) {
  const marginX = bounds.width * LAYOUT_MARGIN_X_RATIO;
  const marginTop = bounds.height * LAYOUT_MARGIN_TOP_RATIO;
  const marginBottom = bounds.height * LAYOUT_MARGIN_BOTTOM_RATIO;
  const safeBottom = parseFloat(getComputedStyle(surface).paddingBottom) || 0;
  const left = Math.min(marginX, Math.max(0, (bounds.width - cardWidth) / 2));
  const right = Math.max(left, bounds.width - cardWidth - marginX);
  const top = Math.min(FILTER_CLEARANCE + marginTop, Math.max(0, bounds.height - cardHeight));
  const bottom = Math.max(top, bounds.height - cardHeight - marginBottom - safeBottom);

  return { left, right, top, bottom };
}

function ratioToPosition(layout, area) {
  return {
    x: area.left + (area.right - area.left) * layout.xRatio,
    y: area.top + (area.bottom - area.top) * layout.yRatio,
  };
}

function positionToRatio(x, y, area) {
  const width = area.right - area.left;
  const height = area.bottom - area.top;

  return {
    xRatio: width === 0 ? 0.5 : (x - area.left) / width,
    yRatio: height === 0 ? 0.5 : (y - area.top) / height,
  };
}

function selectEraByIndex(index) {
  const nextEra = eras[index];

  if (!nextEra || currentEraId === nextEra.id) {
    return;
  }

  currentEraId = nextEra.id;
  active = null;
  renderEraFilters();
  renderCards();
  syncRadioWithEra();
}

function selectEraByOffset(offset, activeEraIndex) {
  if (eras.length === 0) {
    return;
  }

  const currentIndex = activeEraIndex === -1 ? 0 : activeEraIndex;
  const nextIndex = (currentIndex + offset + eras.length) % eras.length;

  selectEraByIndex(nextIndex);
}

function createEraNavButton(direction, activeEraIndex) {
  const button = document.createElement("button");
  const isPrevious = direction === "previous";
  const icon = isPrevious ? ChevronsLeft : ChevronsRight;
  const iconName = isPrevious ? "chevrons-left" : "chevrons-right";

  button.type = "button";
  button.className = `era-nav era-nav-${isPrevious ? "prev" : "next"}`;
  button.setAttribute("aria-label", isPrevious ? "Previous era" : "Next era");
  button.replaceChildren(createLucideSvg(icon, iconName));
  button.addEventListener("click", () => selectEraByOffset(isPrevious ? -1 : 1, activeEraIndex));

  return button;
}

function renderEraFilters() {
  if (!eraYears || !eraButtons) {
    return;
  }

  const activeEraIndex = eras.findIndex((era) => era.id === currentEraId);

  eraYears.style.setProperty("--era-count", eras.length);
  eraButtons.style.setProperty("--era-count", eras.length);
  eraYears.replaceChildren();
  eraButtons.replaceChildren();

  function clearAdjacentHover() {
    eraButtons
      .querySelectorAll(".has-active-before, .has-active-after")
      .forEach((button) => button.classList.remove("has-active-before", "has-active-after"));
  }

  eras.forEach((era, index) => {
    const yearsGroup = document.createElement("span");
    yearsGroup.dataset.eraId = era.id;

    era.years.forEach((year) => {
      const yearItem = document.createElement("span");
      yearItem.textContent = year;
      yearsGroup.append(yearItem);
    });

    if (era.id === currentEraId) {
      yearsGroup.classList.add("is-active");
    }

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = era.label;
    button.dataset.eraId = era.id;
    button.dataset.eraIndex = String(index);

    if (era.id === currentEraId) {
      button.classList.add("is-active");
      button.setAttribute("aria-current", "page");
    }

    button.addEventListener("click", () => {
      selectEraByIndex(index);
    });

    button.addEventListener("mouseenter", () => {
      clearAdjacentHover();

      if (Math.abs(index - activeEraIndex) !== 1) {
        return;
      }

      button.classList.add(index > activeEraIndex ? "has-active-before" : "has-active-after");
    });

    button.addEventListener("mouseleave", clearAdjacentHover);
    button.addEventListener("focus", () => {
      clearAdjacentHover();

      if (Math.abs(index - activeEraIndex) !== 1) {
        return;
      }

      button.classList.add(index > activeEraIndex ? "has-active-before" : "has-active-after");
    });
    button.addEventListener("blur", clearAdjacentHover);

    eraYears.append(yearsGroup);
    if (index === 0) {
      eraButtons.append(createEraNavButton("previous", activeEraIndex));
    }
    eraButtons.append(button);
  });

  eraButtons.append(createEraNavButton("next", activeEraIndex));
}

function carTitle(car) {
  return [car.year, car.make, car.model].filter(Boolean).join(" ");
}

function carCountry(car) {
  return car.country || car.region || "";
}

function symbolOrientation(symbol) {
  return Number(symbol.width) >= Number(symbol.height) ? "landscape" : "portrait";
}

function symbolCrossFactor(symbol) {
  const width = Math.max(Number(symbol.width) || 1, 1);
  const height = Math.max(Number(symbol.height) || 1, 1);
  return (Math.min(width, height) / Math.max(width, height)).toFixed(5);
}

function renderCar(car, index) {
  const button = document.createElement("button");
  button.className = "canvas-item car-card";
  if (WIDE_PHOTO_CARD_IDS.has(car.id)) {
    button.classList.add("is-wide-photo");
  }
  button.type = "button";
  button.dataset.index = String(index);
  button.dataset.id = car.id;
  button.style.zIndex = String(index + 1);
  button.setAttribute("aria-label", `${carTitle(car)}, ${carCountry(car)}`);

  button.innerHTML = `
    <div class="card-face">
      <div class="photo-wrap">
        <img src="./assets/${car.image}" alt="${carTitle(car)}" draggable="false" />
      </div>
      <div class="card-info">
        <span class="make" data-fit-text>${car.make}</span>
        <strong class="model" data-fit-text>${car.model}</strong>
        <span class="meta">
          <span class="year">${car.year}</span>
          <span class="country">${carCountry(car)}</span>
        </span>
      </div>
    </div>
  `;

  return button;
}

function renderSymbol(symbol, index) {
  const button = document.createElement("button");
  const orientation = symbolOrientation(symbol);

  button.className = `canvas-item era-symbol is-${orientation}`;
  button.type = "button";
  button.dataset.index = String(index);
  button.dataset.id = symbol.id;
  button.style.zIndex = String(index + 1);
  button.style.setProperty("--symbol-cross-factor", symbolCrossFactor(symbol));
  button.setAttribute("aria-label", symbol.name);

  button.innerHTML = `<img src="./assets/${symbol.image}" alt="${symbol.name}" draggable="false" />`;

  return button;
}

function renderCards() {
  const currentEra = getCurrentEra();
  const items = getEraItems(currentEra);
  const cardLayout = getEraLayout(currentEra);

  surface.replaceChildren();
  surface.setAttribute("aria-label", `${currentEra.label} car cards and era symbols`);
  topZ = Math.max(items.length, ...cardLayout.map((layout) => layout.zIndex));

  items.forEach(({ type, item }, index) => {
    surface.appendChild(type === "symbol" ? renderSymbol(item, index) : renderCar(item, index));
  });

  layoutCards();
  scheduleTextFit();
}

function layoutCards() {
  const bounds = surface.getBoundingClientRect();
  const cards = [...surface.querySelectorAll(".canvas-item")];
  const cardLayout = getEraLayout(getCurrentEra());

  cards.forEach((card, index) => {
    const layout = cardLayout[index];

    if (!layout) {
      return;
    }

    const cardWidth = card.offsetWidth;
    const cardHeight = card.offsetHeight;
    const position = ratioToPosition(layout, getCardLayoutArea(bounds, cardWidth, cardHeight));

    card.style.zIndex = String(layout.zIndex);
    setCardPosition(card, position.x, position.y, layout.rotation);
  });
}

function fitCardText() {
  const cards = [...surface.querySelectorAll(".car-card")];

  cards.forEach((card) => {
    const labels = [...card.querySelectorAll("[data-fit-text]")];

    if (labels.length === 0) {
      return;
    }

    card.style.removeProperty("--label-scale");

    const defaultSize = Math.max(...labels.map((label) => parseFloat(getComputedStyle(label).fontSize)));
    let sharedScale = 1;

    while (defaultSize * sharedScale > 7) {
      card.style.setProperty("--label-scale", sharedScale.toFixed(3));

      const hasOverflow = labels.some((label) => label.scrollWidth > label.clientWidth + 1);

      if (!hasOverflow) {
        break;
      }

      sharedScale -= 0.025;
    }
  });
}

function scheduleTextFit() {
  requestAnimationFrame(() => {
    requestAnimationFrame(fitCardText);
  });
}

function setCardPosition(card, x, y, rotation = Number(card.dataset.rotation || 0)) {
  const displayX = Math.round(x);
  const displayY = Math.round(y);

  card.dataset.x = String(displayX);
  card.dataset.y = String(displayY);
  card.dataset.rotation = String(rotation);
  card.style.setProperty("--x", `${displayX}px`);
  card.style.setProperty("--y", `${displayY}px`);
  card.style.setProperty("--rotation", `${rotation}deg`);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function getCenterProximity(pointX, pointY) {
  const bounds = surface.getBoundingClientRect();

  if (bounds.width === 0 || bounds.height === 0) {
    return 0;
  }

  const surfaceCenterX = bounds.width / 2;
  const surfaceCenterY = bounds.height / 2;
  const horizontalProximity = 1 - clamp(Math.abs(pointX - surfaceCenterX) / surfaceCenterX, 0, 1);
  const verticalProximity = 1 - clamp(Math.abs(pointY - surfaceCenterY) / surfaceCenterY, 0, 1);

  return smoothstep(Math.min(horizontalProximity, verticalProximity));
}

function getDragWidth(activeDrag, clientX, clientY) {
  const bounds = surface.getBoundingClientRect();
  const pointerX = clientX - bounds.left;
  const pointerY = clientY - bounds.top;
  const edgeWidth = activeDrag.baseLongSide * EDGE_DRAG_SCALE;
  const centerWidth = Math.max(edgeWidth, Math.min(bounds.width * CENTER_DRAG_WIDTH_RATIO, CENTER_DRAG_MAX_WIDTH));
  let width = activeDrag.currentLongSide;

  for (let index = 0; index < 5; index += 1) {
    const scale = width / activeDrag.baseLongSide;
    const cardCenterX = pointerX + (activeDrag.baseWidth / 2 - activeDrag.grabOffsetX) * scale;
    const cardCenterY = pointerY + (activeDrag.baseHeight / 2 - activeDrag.grabOffsetY) * scale;

    width = edgeWidth + (centerWidth - edgeWidth) * getCenterProximity(cardCenterX, cardCenterY);
  }

  return width;
}

function setDragWidth(card, width) {
  if (card.classList.contains("era-symbol")) {
    card.style.setProperty("--symbol-long-side", `${width.toFixed(2)}px`);
    return;
  }

  card.style.setProperty("--card-width", `${width.toFixed(2)}px`);
}

function resetDragWidth(card) {
  if (card.classList.contains("era-symbol")) {
    card.style.removeProperty("--symbol-long-side");
    return;
  }

  card.style.removeProperty("--card-width");
}

function moveActiveCard(clientX, clientY) {
  const bounds = surface.getBoundingClientRect();
  const width = getDragWidth(active, clientX, clientY);
  const scale = width / active.baseLongSide;
  const x = clientX - bounds.left - active.grabOffsetX * scale;
  const y = clientY - bounds.top - active.grabOffsetY * scale;
  const layout = getEraLayout(getCurrentEra())[active.index];

  setDragWidth(active.card, width);
  setCardPosition(active.card, x, y, 0);
  active.currentLongSide = width;
  active.currentWidth = active.baseWidth * scale;
  active.currentHeight = active.baseHeight * scale;

  if (layout) {
    Object.assign(layout, positionToRatio(x, y, getCardLayoutArea(bounds, active.currentWidth, active.currentHeight)), {
      rotation: 0,
      zIndex: Number(active.card.style.zIndex),
    });
  }
}

function beginDrag(card, clientX, clientY, pointerId = "mouse") {
  const bounds = surface.getBoundingClientRect();
  const originalRotation = Number(card.dataset.rotation || 0);
  const x = Number(card.dataset.x);
  const y = Number(card.dataset.y);

  active = {
    card,
    index: Number(card.dataset.index),
    pointerId,
    originalRotation,
    baseWidth: card.offsetWidth,
    baseHeight: card.offsetHeight,
    baseLongSide: Math.max(card.offsetWidth, card.offsetHeight),
    currentWidth: card.offsetWidth,
    currentHeight: card.offsetHeight,
    currentLongSide: Math.max(card.offsetWidth, card.offsetHeight),
    grabOffsetX: clientX - bounds.left - x,
    grabOffsetY: clientY - bounds.top - y,
  };

  card.classList.add("is-dragging");
  card.style.zIndex = String(++topZ);
  moveActiveCard(clientX, clientY);
}

function updateDrag(clientX, clientY, pointerId = active?.pointerId) {
  if (!active || active.pointerId !== pointerId) {
    return;
  }

  moveActiveCard(clientX, clientY);
}

function finishDrag(pointerId = active?.pointerId) {
  if (!active || active.pointerId !== pointerId) {
    return;
  }

  active.card.classList.remove("is-dragging");
  const x = Number(active.card.dataset.x) + (active.currentWidth - active.baseWidth) / 2;
  const y = Number(active.card.dataset.y) + (active.currentHeight - active.baseHeight) / 2;
  const rotation = randomRotation(active.originalRotation);
  const layout = getEraLayout(getCurrentEra())[active.index];

  resetDragWidth(active.card);
  setCardPosition(active.card, x, y, rotation);

  if (layout) {
    Object.assign(layout, positionToRatio(x, y, getCardLayoutArea(surface.getBoundingClientRect(), active.baseWidth, active.baseHeight)), {
      rotation,
      zIndex: Number(active.card.style.zIndex),
    });
  }

  active = null;
}

function randomRotation(excludedRotation) {
  const options = CARD_ROTATIONS.filter((rotation) => rotation !== excludedRotation);
  return options[Math.floor(Math.random() * options.length)] ?? excludedRotation;
}

function onPointerDown(event) {
  const card = event.target.closest(".canvas-item");

  if (!card) {
    return;
  }

  card.setPointerCapture(event.pointerId);
  beginDrag(card, event.clientX, event.clientY, event.pointerId);
}

function onPointerMove(event) {
  updateDrag(event.clientX, event.clientY, event.pointerId);
}

function onMouseDown(event) {
  if ("PointerEvent" in window) {
    return;
  }

  const card = event.target.closest(".canvas-item");

  if (!card) {
    return;
  }

  event.preventDefault();
  beginDrag(card, event.clientX, event.clientY);
}

function onMouseMove(event) {
  if ("PointerEvent" in window) {
    return;
  }

  updateDrag(event.clientX, event.clientY);
}

function onTouchStart(event) {
  if ("PointerEvent" in window) {
    return;
  }

  const card = event.target.closest(".canvas-item");
  const touch = event.changedTouches[0];

  if (!card || !touch) {
    return;
  }

  beginDrag(card, touch.clientX, touch.clientY, touch.identifier);
}

function onTouchMove(event) {
  if ("PointerEvent" in window) {
    return;
  }

  const touch = [...event.changedTouches].find((item) => item.identifier === active?.pointerId);

  if (!touch) {
    return;
  }

  event.preventDefault();
  updateDrag(touch.clientX, touch.clientY, touch.identifier);
}

function onTouchEnd(event) {
  if ("PointerEvent" in window) {
    return;
  }

  const touch = [...event.changedTouches].find((item) => item.identifier === active?.pointerId);

  if (touch) {
    finishDrag(touch.identifier);
  }
}

syncAppViewportHeight();
initialiseEraLayouts();
renderEraFilters();
renderTuneIcon();
const initialEra = getCurrentEra();
renderCards();
preloadRemainingEraImagesAfterInitialRender(initialEra);

document.body.append(radio, tuningLoop);
tuneButton?.addEventListener("click", toggleRadio);
radio.addEventListener("playing", markRadioPlaying);
radio.addEventListener("waiting", markRadioLoading);
radio.addEventListener("stalled", markRadioLoading);
radio.addEventListener("loadstart", markRadioLoading);
radio.addEventListener("error", markRadioFailed);
surface.addEventListener("pointerdown", onPointerDown);
surface.addEventListener("pointermove", onPointerMove);
surface.addEventListener("pointerup", (event) => finishDrag(event.pointerId));
surface.addEventListener("pointercancel", (event) => finishDrag(event.pointerId));
surface.addEventListener("mousedown", onMouseDown);
window.addEventListener("mousemove", onMouseMove);
window.addEventListener("mouseup", () => finishDrag());
surface.addEventListener("touchstart", onTouchStart, { passive: false });
window.addEventListener("touchmove", onTouchMove, { passive: false });
window.addEventListener("touchend", onTouchEnd);
window.addEventListener("touchcancel", onTouchEnd);
window.addEventListener("resize", scheduleViewportLayout);
window.visualViewport?.addEventListener("resize", scheduleViewportLayout);
window.visualViewport?.addEventListener("scroll", scheduleViewportLayout);

window.addEventListener("load", scheduleTextFit);

if (document.fonts) {
  document.fonts.ready.then(scheduleTextFit);
}
