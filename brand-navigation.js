(() => {
  // Preserve links to the former PC sections without moving repair links.
  const pcAnchors = new Set(['intro', 'spec', 'gear', 'food', 'content', 'blog', 'location']);
  function routeLegacyPcLink() {
    const anchor = window.location.hash.slice(1);
    if (!pcAnchors.has(anchor)) return;
    window.location.replace(`oxpc.html${window.location.search}#${anchor}`);
  }
  routeLegacyPcLink();
  window.addEventListener('hashchange', routeLegacyPcLink);
})();
