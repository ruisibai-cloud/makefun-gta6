// Keyboard and mouse. Held keys are read every step; one-shot presses are
// remembered until the loop takes them at the end of the frame, so a press
// between two frames is never lost and never counted twice.
const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyM', 'KeyH',
  'Digit1', 'Digit2', 'Enter', 'Escape', 'KeyP',
]);

export function createInput(canvas) {
  const down = new Set();
  const pressed = new Set();
  const mouse = { x: 0, y: 0, down: false, pressed: false };

  window.addEventListener('keydown', (event) => {
    if (!GAME_KEYS.has(event.code)) return;
    event.preventDefault();
    if (!event.repeat) {
      down.add(event.code);
      pressed.add(event.code);
    }
  });
  window.addEventListener('keyup', (event) => {
    down.delete(event.code);
  });
  // A key released while the tab is hidden never sends keyup.
  window.addEventListener('blur', () => {
    down.clear();
    mouse.down = false;
  });

  function trackPointer(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
  }
  canvas.addEventListener('pointermove', trackPointer);
  canvas.addEventListener('pointerdown', (event) => {
    trackPointer(event);
    if (event.button === 0) {
      mouse.down = true;
      mouse.pressed = true;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) mouse.down = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  return {
    mouse,
    /** True while any of the codes (one string or an array) is held. */
    isDown(codes) {
      if (typeof codes === 'string') return down.has(codes);
      return codes.some((code) => down.has(code));
    },
    /** True when the code was pressed since the last endFrame. */
    pressed(code) {
      return pressed.has(code);
    },
    /** True when the left mouse button went down since the last endFrame. */
    get mousePressed() {
      return mouse.pressed;
    },
    get mouseDown() {
      return mouse.down;
    },
    /** Call once per rendered frame, after the step, to clear the edges. */
    endFrame() {
      pressed.clear();
      mouse.pressed = false;
    },
  };
}
