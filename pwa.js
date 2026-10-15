(() => {
  if (window.Capacitor?.isNativePlatform?.()) return;
  let installPrompt;
  const installButtons = document.querySelectorAll('[data-install]');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installButtons.forEach((button) => { button.hidden = false; });
  });
  installButtons.forEach((button) => button.addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButtons.forEach((item) => { item.hidden = true; });
  }));
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButtons.forEach((button) => { button.hidden = true; });
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready)
        .then(() => {
          const status = document.querySelector('[data-offline-status]');
          if (status) status.textContent = '오프라인 이용 준비 완료';
        }).catch(() => {
          const status = document.querySelector('[data-offline-status]');
          if (status) status.textContent = '온라인 이용 가능';
        });
    });
  }
})();
