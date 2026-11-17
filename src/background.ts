// The toolbar button opens the map in Google Photos.
chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: 'https://photos.google.com/#map' });
});

if (__DEV__) {
  // Dev builds only: a Photos page can ask for a reload after a rebuild
  // (window.dispatchEvent(new Event('photos-map:reload')) from the page).
  chrome.runtime.onMessage.addListener((msg: unknown, sender) => {
    if (sender.id === chrome.runtime.id && (msg as { t?: string } | null)?.t === 'dev:reload') chrome.runtime.reload();
  });
}
