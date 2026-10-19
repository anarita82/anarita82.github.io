const destinations = new Set(['app.html', 'index.html#seoulmouse', 'mouse-test.html', 'index.html']);
const sources = { naver_blog: 'referral', naver_cafe: 'referral', kakao: 'social', qr: 'offline' };
export function campaignLink(destination, source, campaign) {
  if (!destinations.has(destination) || !Object.hasOwn(sources, source)) throw new Error('지원하지 않는 경로입니다.');
  const name = campaign.trim();
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(name)) throw new Error('캠페인은 영문·숫자·밑줄·하이픈·마침표로 1~80자를 입력해 주세요.');
  const url = new URL(destination, 'https://anarita82.github.io/');
  url.searchParams.set('utm_source', source);
  url.searchParams.set('utm_medium', sources[source]);
  url.searchParams.set('utm_campaign', name);
  return url.href;
}
