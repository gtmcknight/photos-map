/**
 * False once the extension was reloaded or updated under this page: this copy
 * of the script is cut off, and chrome.* calls throw until the page reloads.
 */
export const alive = (): boolean => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};
