import { newClicks, recordClick } from './mouse-test-core.mjs';
const $ = (selector) => document.querySelector(selector);
const names = ['왼쪽', '가운데', '오른쪽'];
let clicks = newClicks();
const clickPad = $('#click-pad');
function renderClicks() {
  clicks.forEach((item, index) => {
    $('#count-' + index).textContent = item.count;
    $('#fast-' + index).textContent = item.fast;
    $('#interval-' + index).textContent = item.interval === null ? '—' : Math.round(item.interval) + 'ms';
  });
}
clickPad.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') { $('#click-status').textContent = '실제 마우스를 연결해 주세요.'; return; }
  event.preventDefault();
  const result = recordClick(clicks, event.button, event.timeStamp);
  if (!result) return;
  renderClicks();
  clickPad.classList.toggle('fast', result.isFast);
  $('#click-status').textContent = names[event.button] + (result.isFast ? ' · 80ms 이하 입력 감지' : ' · 입력 기록됨');
});
for (const type of ['contextmenu', 'auxclick']) clickPad.addEventListener(type, (event) => event.preventDefault());
$('#reset-click').addEventListener('click', () => {
  clicks = newClicks(); renderClicks(); clickPad.classList.remove('fast'); $('#click-status').textContent = '마우스 입력 대기';
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
  if (canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
}
canvas.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') { $('#drag-status').textContent = '실제 마우스를 연결해 주세요.'; return; }
  if (event.button !== 0 || active) return;
  event.preventDefault();
  active = { id: event.pointerId, start: performance.now(), last: point(event) };
  canvas.setPointerCapture(event.pointerId);
  $('#drag-status').textContent = '왼쪽 버튼 유지 중';
  tick();
});
canvas.addEventListener('pointermove', (event) => {
  if (!active || active.id !== event.pointerId) return;
  if (!(event.buttons & 1)) { finish('왼쪽 버튼 해제 상태 감지'); return; }
  const next = point(event);
  ctx.strokeStyle = '#72e4c2'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(active.last.x, active.last.y); ctx.lineTo(next.x, next.y); ctx.stroke(); active.last = next;
});
canvas.addEventListener('pointerup', (event) => { if (active?.id === event.pointerId && !(event.buttons & 1)) finish('왼쪽 버튼 해제'); });
canvas.addEventListener('pointercancel', () => finish('브라우저 입력 취소 · 다시 측정', true));
canvas.addEventListener('lostpointercapture', () => finish('입력 추적 중단 · 다시 측정', true));
window.addEventListener('blur', () => finish('창 포커스 이탈 · 다시 측정', true));
document.addEventListener('visibilitychange', () => { if (document.hidden) finish('탭 전환 · 다시 측정', true); });
for (const type of ['contextmenu', 'auxclick']) canvas.addEventListener(type, (event) => event.preventDefault());
$('#reset-drag').addEventListener('click', () => {
  finish('초기화', true); releases = 0; cancels = 0; logs = []; ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('#hold-time').textContent = '0.0초'; $('#release-count').textContent = '0'; $('#cancel-count').textContent = '0';
  $('#drag-status').textContent = '마우스 입력 대기'; const li = document.createElement('li'); li.textContent = '아직 기록이 없습니다.'; $('#drag-log').replaceChildren(li);
});
