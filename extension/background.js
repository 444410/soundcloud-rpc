const SERVER_URL = 'http://127.0.0.1:3020';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRACK_UPDATE') {
    forwardTrackUpdate(message.data)
      .then(res => sendResponse({ success: true, res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === 'CLEAR_TRACK') {
    forwardClear(message.reason)
      .then(res => sendResponse({ success: true, res }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function forwardTrackUpdate(trackData) {
  try {
    const res = await fetch(`${SERVER_URL}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trackData)
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

async function forwardClear(reason = 'Tab closed') {
  try {
    const res = await fetch(`${SERVER_URL}/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.soundcloud.com/*' });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        }).catch(() => {});
      }
    }
  } catch (_) {}
});
