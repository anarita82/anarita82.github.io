import { newClicks, recordClick } from './mouse-test-core.mjs?v=20261019-side';
const $ = (selector) => document.querySelector(selector);
const names = ['왼쪽', '가운데', '오른쪽', '사이드 뒤로', '사이드 앞으로'];
let clicks = newClicks();
const clickPad = $('#click-pad');
const wheelPad = clickPad;
let wheelUp = 0;
let wheelDown = 0;
function resetWheel() {
  wheelUp = 0; wheelDown = 0;
  $('#wheel-up').textContent = '0';
  $('#wheel-down').textContent = '0';
  $('#wheel-total').textContent = '0';
  $('#wheel-direction').textContent = '대기';
  wheelPad.classList.toggle('up', false);
  wheelPad.classList.toggle('down', false);
}
wheelPad.addEventListener('wheel', (event) => {
  if (event.ctrlKey) return;
  event.preventDefault();
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  const up = event.deltaY < 0;
  if (up) wheelUp++; else wheelDown++;
  $('#wheel-up').textContent = String(wheelUp);
  $('#wheel-down').textContent = String(wheelDown);
  $('#wheel-total').textContent = String(wheelUp + wheelDown);
  $('#wheel-direction').textContent = up ? '↑ 위' : '↓ 아래';
  wheelPad.classList.toggle('up', up);
  wheelPad.classList.toggle('down', !up);
}, { passive: false });
const buttonMasks = [1, 4, 2, 8, 16];
let heldButtons = 0;
let clickPointer = null;
let doubleDetected = false;
let simultaneousDetected = false;
function alertTitle() {
  return [doubleDetected && '더블', simultaneousDetected && '동시 입력'].filter(Boolean).join(' · ');
}
function renderClicks() {
  $('#click-total').textContent = '전체 클릭 ' + clicks.reduce((sum, item) => sum + item.count, 0) + '회';
  $('#double-total').textContent = '더블클릭 감지 ' + clicks.reduce((sum, item) => sum + item.fast, 0) + '회';
  clicks.forEach((item, index) => {
    $('#count-' + index).textContent = item.count;
    $('#fast-' + index).textContent = item.fast;
    $('#interval-' + index).textContent = item.interval === null ? '—' : Math.round(item.interval) + 'ms';
  });
}
function updateClickButtons(event) {
  const next = event.buttons & 31;
  const newlyPressed = next & ~heldButtons;
  const pressed = [];
  if (newlyPressed) {
    buttonMasks.forEach((mask, button) => {
      if (!(newlyPressed & mask)) return;
      const result = recordClick(clicks, button, event.timeStamp);
      if (result) { doubleDetected ||= result.isFast; pressed.push(names[button]); }
    });
    renderClicks();
  }
  heldButtons = next;
  const multiple = (next & (next - 1)) !== 0;
  simultaneousDetected ||= multiple;
  clickPad.classList.toggle('fast', doubleDetected || simultaneousDetected);
  $('#click-pad strong').textContent = alertTitle() || '클릭·휠·드래그 측정 영역';
  if (multiple) {
    const heldNames = names.filter((_, index) => next & buttonMasks[index]);
    $('#click-status').textContent = (doubleDetected ? '더블 · ' : '') + heldNames.join(' + ') + ' · 동시 입력 감지';
  } else if (doubleDetected || simultaneousDetected) {
    $('#click-status').textContent = alertTitle() + ' 감지 · 초기화 전까지 경고 유지';
  } else if (pressed.length) {
    $('#click-status').textContent = pressed.join(' + ') + ' · 입력 기록됨';
  }
}
clickPad.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') {
    $('#drag-status').textContent = '실제 마우스를 연결해 주세요.';
    if (!doubleDetected && !simultaneousDetected) $('#click-status').textContent = '실제 마우스를 연결해 주세요.';
    return;
  }
  event.preventDefault();
  clickPointer = event.pointerId;
  clickPad.setPointerCapture(event.pointerId);
  updateClickButtons(event);
  beginDrag(event);
});
// Browser double-click timing is unrelated to the per-button chatter threshold.
clickPad.addEventListener('dblclick', (event) => event.preventDefault());
// Additional mouse-button presses arrive as pointermove, not another pointerdown.
clickPad.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'mouse' && event.pointerId === clickPointer) { updateClickButtons(event); moveDrag(event); }
});
clickPad.addEventListener('pointerup', (event) => {
  event.preventDefault();
  if (event.pointerId === clickPointer) updateClickButtons(event);
  if (active?.id === event.pointerId && !(event.buttons & active.mask)) finish(active.label + ' 버튼 해제');
});
function stopClickTracking() {
  const id = clickPointer;
  heldButtons = 0; clickPointer = null;
  clickPad.classList.toggle('fast', doubleDetected || simultaneousDetected);
  $('#click-status').textContent = alertTitle() ? alertTitle() + ' 감지 · 초기화 전까지 경고 유지' : '마우스 입력 대기';
  if (id !== null && clickPad.hasPointerCapture(id)) clickPad.releasePointerCapture(id);
}
clickPad.addEventListener('pointercancel', stopClickTracking);
clickPad.addEventListener('lostpointercapture', stopClickTracking);
// Cancel navigation only inside the test pad; normal browser shortcuts remain available elsewhere.
for (const type of ['mousedown', 'mouseup', 'contextmenu', 'auxclick']) {
  clickPad.addEventListener(type, (event) => event.preventDefault());
}
$('#reset-click').addEventListener('click', () => {
  doubleDetected = false; simultaneousDetected = false; stopClickTracking(); clicks = newClicks(); renderClicks();
  $('#click-pad strong').textContent = '클릭·휠·드래그 측정 영역';
  resetWheel();
  resetDrag();
});
const canvas = $('#drag-pad');
const ctx = canvas.getContext('2d');
let active = null;
let releases = 0;
let cancels = 0;
let logs = [];
let frame = 0;
function point(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}
function tick() {
  if (!active) return;
  $('#hold-time').textContent = ((performance.now() - active.start) / 1000).toFixed(1) + '초';
  frame = requestAnimationFrame(tick);
}
function finish(reason, cancelled = false) {
  if (!active) return;
  const previous = active;
  active = null;
  cancelAnimationFrame(frame);
  const duration = ((performance.now() - previous.start) / 1000).toFixed(1);
  $('#hold-time').textContent = duration + '초';
  if (cancelled) cancels++; else releases++;
  $('#release-count').textContent = releases;
  $('#cancel-count').textContent = cancels;
  $('#drag-status').textContent = reason;
  logs.unshift(duration + '초 · ' + reason);
  logs = logs.slice(0, 12);
  $('#drag-log').replaceChildren(...logs.map((text) => { const li = document.createElement('li'); li.textContent = text; return li; }));
  // Pointer capture belongs to the shared pad until all mouse buttons are released.
}
function beginDrag(event) {
  if (event.pointerType !== 'mouse') { $('#drag-status').textContent = '실제 마우스를 연결해 주세요.'; return; }
  if (![0, 2].includes(event.button) || active) return;
  event.preventDefault();
  active = { id: event.pointerId, start: performance.now(), last: point(event),
    mask: event.button === 0 ? 1 : 2, label: names[event.button] };
  $('#drag-status').textContent = active.label + ' 버튼 유지 중';
  tick();
}
function moveDrag(event) {
  if (!active || active.id !== event.pointerId) return;
  if (!(event.buttons & active.mask)) { finish(active.label + ' 버튼 해제 상태 감지'); return; }
  const next = point(event);
  ctx.strokeStyle = '#72e4c2'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(active.last.x, active.last.y); ctx.lineTo(next.x, next.y); ctx.stroke(); active.last = next;
}
clickPad.addEventListener('pointercancel', () => finish('브라우저 입력 취소 · 다시 측정', true));
clickPad.addEventListener('lostpointercapture', () => finish('입력 추적 중단 · 다시 측정', true));
window.addEventListener('blur', () => {
  finish('창 포커스 이탈 · 다시 측정', true); stopClickTracking();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { finish('탭 전환 · 다시 측정', true); stopClickTracking(); }
});
function resetDrag() {
  finish('초기화', true); releases = 0; cancels = 0; logs = []; ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('#hold-time').textContent = '0.0초'; $('#release-count').textContent = '0'; $('#cancel-count').textContent = '0';
  $('#drag-status').textContent = '마우스 입력 대기'; const li = document.createElement('li'); li.textContent = '아직 기록이 없습니다.'; $('#drag-log').replaceChildren(li);
}
$('#reset-drag').addEventListener('click', resetDrag);
