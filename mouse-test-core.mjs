export const FAST_INTERVAL = 80;
export function estimateScreenSensitivity(pixels, cm) {
  if (!Number.isFinite(pixels) || pixels <= 0 || !Number.isFinite(cm) || cm < 0.1 || cm > 100) return null;
  return pixels * 2.54 / cm;
}
export function describeBrowserButton(button) {
  const labels = ['왼쪽', '가운데', '오른쪽', '사이드 뒤로', '사이드 앞으로'];
  return labels[button] ? '전달 입력: ' + labels[button] : '전달 입력: 버튼 번호 ' + button;
}
export function newClicks() {
  return Array.from({ length: 5 }, () => ({ count: 0, fast: 0, last: null, interval: null }));
}
export function recordClick(state, button, time) {
  if (!Number.isInteger(button) || button < 0 || button > 4 || !Number.isFinite(time)) return null;
  const item = state[button];
  item.interval = item.last === null ? null : time - item.last;
  const fast = item.interval !== null && item.interval >= 0 && item.interval <= FAST_INTERVAL;
  item.count++;
  if (fast) item.fast++;
  item.last = time;
  return { ...item, isFast: fast };
}
