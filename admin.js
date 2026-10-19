import { campaignLink } from './campaign-links.mjs';
const $ = (selector) => document.querySelector(selector);
function updateLink() {
  try {
    $('#campaign-url').value = campaignLink($('#destination').value, $('#source').value, $('#campaign').value);
    $('#copy-status').textContent = '';
  } catch (error) { $('#campaign-url').value = ''; $('#copy-status').textContent = error.message; }
}
$('#campaign-form').addEventListener('submit', (event) => { event.preventDefault(); updateLink(); });
$('#copy-campaign').addEventListener('click', async () => {
  updateLink();
  if (!$('#campaign-url').value) return;
  try { await navigator.clipboard.writeText($('#campaign-url').value); $('#copy-status').textContent = '링크가 복사되었습니다.'; }
  catch { $('#copy-status').textContent = '공유 링크를 직접 선택해 복사해 주세요.'; }
});
updateLink();
try {
  const response = await fetch('./admin-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('config');
  const config = await response.json();
  if (!/^\d+$/.test(String(config.propertyId || ''))) throw new Error('pending');
  let connected = 0;
  document.querySelectorAll('[data-report]').forEach((link) => {
    const href = config.reports?.[link.dataset.report];
    if (!href) return;
    const url = new URL(href);
    if (url.origin !== 'https://analytics.google.com' || !url.hash.includes('p' + config.propertyId + '/')) return;
    link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.removeAttribute('aria-disabled'); connected++;
  });
  $('#connection-status').textContent = connected ? '전용 통계 보고서 연결됨 · 구글 로그인 필요' : '전용 보고서 연결 준비 중';
} catch { $('#connection-status').textContent = '방문 통계 수집 연결 대기 · 아직 이 사이트의 통계가 집계되지 않습니다.'; }
