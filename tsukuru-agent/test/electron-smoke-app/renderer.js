window.smokeResult = {
  bridgeAvailable: Boolean(window.tsukuru),
  arbitraryRejected: false,
  arbitraryInvokeRejected: false,
  invokeResult: null,
  eventPayload: null,
  nodeRequireType: typeof require,
  processType: typeof process,
};

window.tsukuru.on('alert', (payload) => {
  window.smokeResult.eventPayload = payload;
});

try {
  window.tsukuru.send('arbitrary:channel', 'blocked');
} catch {
  window.smokeResult.arbitraryRejected = true;
}

window.tsukuru.send('changeLang', 'ko');

window.tsukuru.invoke('openFolder', 'smoke-path').then((value) => {
  window.smokeResult.invokeResult = value;
});

window.tsukuru.invoke('arbitrary:invoke', 'blocked').catch(() => {
  window.smokeResult.arbitraryInvokeRejected = true;
});
