import { estimateScreenSensitivity, describeBrowserButton } from './mouse-test-core.mjs?v=20261020-dpi';
const dpiElement = (id) => document.getElementById(id);
const movePad = dpiElement('dpi-move-pad');
const buttonPad = dpiElement('dpi-button-pad');
let movement = null;
let inputCount = 0;
function clearEstimate(message = '측정 대기') {
  dpiElement('dpi-estimate').textContent = message;
  dpiElement('dpi-pixels').textContent = '0';
}
function cancelMovement(message) {
  const previous = movement;
  movement = null;
  if (previous && movePad.hasPointerCapture(previous.id)) movePad.releasePointerCapture(previous.id);
  if (previous) clearEstimate(message);
}
dpiElement('dpi-setting').addEventListener('input', () => {
  const input = dpiElement('dpi-setting');
  const valid = input.value !== '' && input.validity.valid;
  dpiElement('dpi-setting-status').textContent = valid
    ? Number(input.value).toLocaleString('ko-KR') + ' DPI · 직접 입력한 설정값'
    : '설정 DPI 미입력 또는 범위 오류 · 자동 감지 불가';
});
dpiElement('dpi-distance').addEventListener('input', () => {
  cancelMovement('이동 거리 변경 · 다시 측정');
  clearEstimate();
});
movePad.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || movement) return;
  const input = dpiElement('dpi-distance');
  if (!input.validity.valid || !input.value) { clearEstimate('이동 거리 0.1~100cm 입력 필요'); return; }
  event.preventDefault();
  movement = { id: event.pointerId, x: event.clientX, y: event.clientY, cm: Number(input.value) };
  movePad.setPointerCapture(event.pointerId);
  clearEstimate('측정 중');
});
movePad.addEventListener('pointerup', (event) => {
  if (!movement || event.pointerId !== movement.id || event.button !== 0) return;
  const previous = movement;
  movement = null;
  const pixels = Math.hypot(event.clientX - previous.x, event.clientY - previous.y);
  const estimate = estimateScreenSensitivity(pixels, previous.cm);
  dpiElement('dpi-pixels').textContent = String(Math.round(pixels));
  dpiElement('dpi-estimate').textContent = estimate === null ? '이동 없음 · 다시 측정' : Math.round(estimate).toLocaleString('ko-KR') + ' px/in · 참고값';
  if (movePad.hasPointerCapture(previous.id)) movePad.releasePointerCapture(previous.id);
});
for (const type of ['pointercancel', 'lostpointercapture']) movePad.addEventListener(type, () => cancelMovement('측정 중단 · 다시 측정'));
window.addEventListener('blur', () => cancelMovement('창 이탈 · 다시 측정'));
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelMovement('탭 전환 · 다시 측정'); });
buttonPad.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button < 0) return;
  event.preventDefault();
  inputCount++;
  dpiElement('dpi-button-status').textContent = describeBrowserButton(event.button) + ' · DPI 여부 확인 불가';
  dpiElement('dpi-button-count').textContent = '전달 입력 ' + inputCount + '회';
});
for (const type of ['mousedown', 'mouseup', 'contextmenu', 'auxclick']) {
  buttonPad.addEventListener(type, (event) => event.preventDefault());
}
dpiElement('reset-dpi').addEventListener('click', () => {
  cancelMovement('측정 대기'); clearEstimate(); inputCount = 0;
  dpiElement('dpi-button-count').textContent = '전달 입력 0회';
  dpiElement('dpi-button-status').textContent = '입력 대기 · DPI 전용 신호 식별 불가';
});
