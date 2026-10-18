(() => {
  const allowed = ['/capture','/capture-review'].includes(location.pathname) && (
    location.origin === 'https://reader.example.org' ||
    location.origin === 'https://dayofflondon.com' || location.origin === 'https://www.dayofflondon.com' ||
    (location.protocol === 'http:' && ['127.0.0.1','localhost'].includes(location.hostname))
  );
  const requested = new URL(location.href).searchParams.get('captureNonce');
  if (!allowed || !/^[a-f0-9]{48}$/.test(requested || '')) return;
  window.addEventListener('ret-request-capture', async (event) => {
    if (event.detail?.nonce !== requested) return;
    const {retReviewedCapture: record} = await chrome.storage.local.get('retReviewedCapture');
    if (!record || record.nonce !== requested || !/^[a-f0-9]{48}$/.test(record.nonce) ||
        !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now() || record.expiresAt > Date.now() + 600000 ||
        !['ret-capture/v1','ret-media/v1'].includes(record.capture?.schema)) return;
    await chrome.storage.local.remove('retReviewedCapture');
    window.dispatchEvent(new CustomEvent('ret-capture-ready', {detail: {capture: record.capture, nonce: record.nonce}}));
  }, {once: true});
})();
