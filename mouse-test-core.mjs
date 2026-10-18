export const FAST_INTERVAL = 80;
export function newClicks() {
  return Array.from({ length: 3 }, () => ({ count: 0, fast: 0, last: null, interval: null }));
}
export function recordClick(state, button, time) {
  if (!Number.isInteger(button) || button < 0 || button > 2 || !Number.isFinite(time)) return null;
  const item = state[button];
  item.interval = item.last === null ? null : time - item.last;
  const fast = item.interval !== null && item.interval >= 0 && item.interval <= FAST_INTERVAL;
  item.count++;
  if (fast) item.fast++;
  item.last = time;
  return { ...item, isFast: fast };
}
