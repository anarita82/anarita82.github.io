(() => {
  const id = 'G-CEDPCH4LDE';
  const key = 'seoulmouse-analytics-consent-v1';
  let started = false;
  let banner;
  function readChoice() {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function start() {
    if (started || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
    started = true;
    window.dataLayer = window.dataLayer || [];
    const gtag = function () { window.dataLayer.push(arguments); };
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    gtag('js', new Date());
    // Keep arbitrary URL parameters, fragments and referring-page paths out of analytics.
    const page = new URL(location.origin + location.pathname);
    const incoming = new URL(location.href);
    for (const name of ['utm_source', 'utm_medium', 'utm_campaign']) {
      const value = incoming.searchParams.get(name);
      if (value && /^[a-zA-Z0-9_.-]{1,80}$/.test(value)) page.searchParams.set(name, value);
    }
    let referrer = '';
    try { referrer = new URL(document.referrer).origin; } catch { /* Direct visit. */ }
    gtag('config', id, { send_page_view: false, allow_google_signals: false,
      allow_ad_personalization_signals: false, page_location: page.href, page_referrer: referrer, cookie_expires: 2419200 });
    gtag('event', 'page_view', { page_location: page.href, page_referrer: referrer, page_title: document.title });
    const tag = document.createElement('script');
    tag.async = true; tag.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
    document.head.append(tag);
  }
  function choose(value) {
    try { localStorage.setItem(key, value); } catch { /* Choice applies to this page only. */ }
    banner?.remove(); document.body.classList.remove('analytics-prompt-open');
    if (value === 'granted') start();
    else if (started) {
      window['ga-disable-' + id] = true;
      for (const cookie of document.cookie.split(';')) {
        const name = cookie.split('=')[0].trim();
        if (!/^_ga(?:_|$)/.test(name)) continue;
        for (const domain of ['', '; domain=' + location.hostname, '; domain=.' + location.hostname]) {
          document.cookie = name + '=; Max-Age=0; path=/' + domain + '; SameSite=Lax; Secure';
        }
      }
      location.reload();
    }
  }
  function showChoice() {
    if (banner?.isConnected) return;
    banner = document.createElement('section'); banner.className = 'analytics-prompt';
    banner.setAttribute('aria-label', '방문 통계 선택');
    const text = document.createElement('p');
    text.textContent = '방문 현황·유입 경로 확인을 위해 Google Analytics 쿠키를 사용해도 될까요? 거부해도 모든 서비스를 이용할 수 있습니다.';
    const actions = document.createElement('div');
    for (const [label, value] of [['동의', 'granted'], ['거부', 'denied']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => choose(value)); actions.append(button);
    }
    const privacy = document.createElement('a'); privacy.href = 'privacy.html'; privacy.textContent = '개인정보 안내';
    actions.append(privacy); banner.append(text, actions); document.body.append(banner);
    document.body.classList.add('analytics-prompt-open');
  }
  document.querySelector('[data-analytics-settings]')?.addEventListener('click', showChoice);
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;
  const choice = readChoice();
  if (choice === 'granted') start(); else if (choice !== 'denied') showChoice();
})();
