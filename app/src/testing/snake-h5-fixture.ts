export const SNAKE_H5_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>贪吃蛇</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); background: #101711; }
    main { width: min(100%, 440px); display: grid; gap: 14px; color: #f4f8f4; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: clamp(24px, 8vw, 36px); }
    output { font-variant-numeric: tabular-nums; }
    canvas { width: 100%; aspect-ratio: 1; display: block; border-radius: 18px; background: #17251a; touch-action: none; outline: none; }
    canvas:focus-visible { box-shadow: 0 0 0 3px #a9e6ae; }
    .controls { display: grid; grid-template-columns: repeat(3, minmax(56px, 1fr)); gap: 8px; }
    button { min-height: 48px; border: 0; border-radius: 14px; font: inherit; font-weight: 650; color: #102012; background: #b8efbd; }
    button:active { transform: scale(.97); }
    [data-direction="up"] { grid-column: 2; }
    [data-direction="left"] { grid-column: 1; }
    [data-direction="down"] { grid-column: 2; }
    [data-direction="right"] { grid-column: 3; }
    #restart { width: 100%; background: #eef5ef; }
  </style>
</head>
<body>
  <main>
    <header><h1>贪吃蛇</h1><output id="score" aria-live="polite">得分 0</output></header>
    <canvas id="game" tabindex="0" aria-label="贪吃蛇游戏区域"></canvas>
    <div class="controls" aria-label="方向控制">
      <button type="button" data-direction="up">上</button>
      <button type="button" data-direction="left">左</button>
      <button type="button" data-direction="down">下</button>
      <button type="button" data-direction="right">右</button>
    </div>
    <button id="restart" type="button">重新开始</button>
  </main>
  <script src="game.js"></script>
</body>
</html>
`;

export const SNAKE_H5_SCRIPT = `const canvas = document.querySelector("#game");
const context = canvas.getContext("2d");
const scoreOutput = document.querySelector("#score");
const restart = document.querySelector("#restart");
const directionButtons = document.querySelectorAll("[data-direction]");
const gridSize = 18;
const stepMs = 115;
const vectors = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const opposite = { up: "down", down: "up", left: "right", right: "left" };
let snake;
let food;
let direction;
let queuedDirection;
let score;
let running;
let lastStep;
let animationFrame = 0;

function foodPosition() {
  for (let attempt = 0; attempt < gridSize * gridSize; attempt += 1) {
    const candidate = {
      x: Math.floor(Math.random() * gridSize),
      y: Math.floor(Math.random() * gridSize),
    };
    if (!snake.some((part) => part.x === candidate.x && part.y === candidate.y)) return candidate;
  }
  return { x: 0, y: 0 };
}

function setDirection(next) {
  if (!vectors[next] || opposite[direction] === next) return;
  queuedDirection = next;
}

function draw() {
  const size = canvas.clientWidth;
  const cell = size / gridSize;
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#ffcf66";
  context.beginPath();
  context.arc((food.x + 0.5) * cell, (food.y + 0.5) * cell, cell * 0.32, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#86dc8e";
  for (const part of snake) {
    context.fillRect(part.x * cell + 1, part.y * cell + 1, cell - 2, cell - 2);
  }
}

function resize() {
  const size = Math.max(1, canvas.clientWidth);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}

function endGame() {
  running = false;
  scoreOutput.textContent = "游戏结束 · 得分 " + score;
}

function advance() {
  direction = queuedDirection;
  const vector = vectors[direction];
  const head = { x: snake[0].x + vector.x, y: snake[0].y + vector.y };
  const outside = head.x < 0 || head.y < 0 || head.x >= gridSize || head.y >= gridSize;
  const hitSelf = snake.some((part) => part.x === head.x && part.y === head.y);
  if (outside || hitSelf) return endGame();
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score += 1;
    scoreOutput.textContent = "得分 " + score;
    food = foodPosition();
  } else {
    snake.pop();
  }
  draw();
}

function frame(now) {
  if (!running) {
    animationFrame = 0;
    return;
  }
  if (now - lastStep >= stepMs) {
    lastStep = now;
    advance();
  }
  animationFrame = running ? requestAnimationFrame(frame) : 0;
}

function reset() {
  snake = [{ x: 6, y: 9 }, { x: 5, y: 9 }, { x: 4, y: 9 }];
  direction = "right";
  queuedDirection = "right";
  score = 0;
  running = true;
  food = foodPosition();
  lastStep = performance.now();
  scoreOutput.textContent = "得分 0";
  draw();
  canvas.focus();
  if (!animationFrame) animationFrame = requestAnimationFrame(frame);
}

const keyDirections = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
window.addEventListener("keydown", (event) => {
  const next = keyDirections[event.key];
  if (!next) return;
  event.preventDefault();
  setDirection(next);
});
for (const button of directionButtons) {
  button.addEventListener("click", () => setDirection(button.dataset.direction));
}

let pointerStart = null;
canvas.addEventListener("pointerdown", (event) => {
  pointerStart = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  if (!pointerStart) return;
  const x = event.clientX - pointerStart.x;
  const y = event.clientY - pointerStart.y;
  pointerStart = null;
  if (Math.max(Math.abs(x), Math.abs(y)) < 18) return;
  setDirection(Math.abs(x) > Math.abs(y) ? (x > 0 ? "right" : "left") : (y > 0 ? "down" : "up"));
});
restart.addEventListener("click", reset);
window.addEventListener("resize", resize);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = 0;
  } else if (!document.hidden && !animationFrame) {
    lastStep = performance.now();
    animationFrame = requestAnimationFrame(frame);
  }
});

reset();
resize();
`;
