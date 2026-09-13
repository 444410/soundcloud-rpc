(() => {
  if (window.__SOUNDCLOUD_RPC_INJECTED__) return;
  window.__SOUNDCLOUD_RPC_INJECTED__ = true;

  let lastTrackJson = '';
  let syncInterval = null;

  function parseTime(timeStr) {
    if (!timeStr) return 0;
    const match = timeStr.match(/\b(?:\d+:)?\d+:\d+\b/);
    const target = match ? match[0] : timeStr;
    const parts = target.trim().replace(/[^\d:]/g, '').split(':').map(Number);
    if (parts.length === 2) return (parts[0] * 60) + parts[1];
    if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    return 0;
  }

  function cleanTitle(raw) {
    if (!raw) return '';
    let title = raw.trim().replace(/^Current track:\s*/i, '').trim();
    const len = title.length;
    if (len >= 4 && len % 2 === 0) {
      const half = len / 2;
      if (title.slice(0, half) === title.slice(half)) {
        title = title.slice(0, half);
      }
    }
    return title.trim();
  }

  function extractTrackData() {
    const playButton = document.querySelector('.playControls__play') || 
                       document.querySelector('button.playControl') ||
                       document.querySelector('[aria-label*="Pause current"], [aria-label*="Play current"]');
    
    let isPlaying = false;
    if (playButton) {
      const label = (playButton.getAttribute('aria-label') || '').toLowerCase();
      const titleAttr = (playButton.getAttribute('title') || '').toLowerCase();
      isPlaying = playButton.classList.contains('playing') || 
                  label.includes('pause') || 
                  titleAttr.includes('pause');
    }

    const media = navigator.mediaSession?.metadata;

    let title = '';
    const titleElem = document.querySelector('.playbackSoundBadge__titleLink');
    if (titleElem) {
      title = titleElem.getAttribute('title') || 
              titleElem.querySelector('span[aria-hidden="true"]')?.innerText ||
              titleElem.querySelector('span:not(.sc-visuallyhidden)')?.innerText ||
              cleanTitle(titleElem.innerText);
    }
    if (!title && media?.title) title = media.title;
    title = cleanTitle(title);

    let artist = '';
    const artistElem = document.querySelector('.playbackSoundBadge__lightLink') ||
                       document.querySelector('.playbackSoundBadge__titleContextContainer a:not(.playbackSoundBadge__titleLink)');
    if (artistElem) {
      artist = artistElem.getAttribute('title') || 
               artistElem.querySelector('span[aria-hidden="true"]')?.innerText ||
               artistElem.innerText || '';
    }
    if (!artist && media?.artist) artist = media.artist;
    artist = artist.trim();

    if (!title && !artist) return null;

    let artwork = '';
    if (media?.artwork?.length) {
      const highest = media.artwork[media.artwork.length - 1];
      if (highest && highest.src && highest.src.startsWith('http')) {
        artwork = highest.src;
      }
    }

    if (!artwork) {
      const candidates = [
        document.querySelector('.playbackSoundBadge__avatar span.sc-artwork'),
        document.querySelector('.playbackSoundBadge__avatar [style*="background-image"]'),
        document.querySelector('.playbackSoundBadge .sc-artwork'),
        document.querySelector('.playbackSoundBadge span[style*="background-image"]'),
        document.querySelector('.playbackSoundBadge .image__light'),
        document.querySelector('.playbackSoundBadge img')
      ];

      for (const el of candidates) {
        if (!el) continue;
        if (el.tagName === 'IMG' && el.src && el.src.startsWith('http')) {
          artwork = el.src;
          break;
        }
        const bg = el.style?.backgroundImage || window.getComputedStyle(el)?.backgroundImage || '';
        if (bg && bg !== 'none') {
          const match = bg.match(/url\(["']?(.*?)["']?\)/i);
          if (match && match[1]) {
            const cleaned = match[1].replace(/&quot;/g, '').replace(/^["']|["']$/g, '').trim();
            if (cleaned.startsWith('http')) {
              artwork = cleaned;
              break;
            }
          }
        }
      }
    }

    if (artwork) {
      artwork = artwork.replace(/-t\d+x\d+\.(jpg|png|jpeg)/i, '-t500x500.$1').replace(/-large\.(jpg|png|jpeg)/i, '-t500x500.$1');
    }

    let link = '';
    if (titleElem && titleElem.href) {
      link = titleElem.href;
    } else if (titleElem && titleElem.getAttribute('href')) {
      link = window.location.origin + titleElem.getAttribute('href');
    } else {
      link = window.location.href;
    }

    let currentTime = 0;
    let duration = 0;

    const audio = document.querySelector('audio');
    if (audio && !isNaN(audio.currentTime) && !isNaN(audio.duration) && audio.duration > 0) {
      currentTime = audio.currentTime;
      duration = audio.duration;
      if (audio.paused !== undefined) isPlaying = !audio.paused;
    } else {
      const timePassedElem = document.querySelector('.playbackTimeline__timePassed');
      const durationElem = document.querySelector('.playbackTimeline__duration');

      if (timePassedElem) {
        const text = timePassedElem.querySelector('span[aria-hidden="true"]')?.innerText || timePassedElem.innerText;
        currentTime = parseTime(text);
      }
      if (durationElem) {
        const text = durationElem.querySelector('span[aria-hidden="true"]')?.innerText || durationElem.innerText;
        duration = parseTime(text);
      }
    }

    return {
      title: title || 'SoundCloud Track',
      artist: artist || 'Unknown Artist',
      artwork: artwork,
      link: link,
      currentTime: Math.floor(currentTime),
      duration: Math.floor(duration),
      playing: isPlaying
    };
  }

  function sendToBackground(type, data) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type, data }, () => {
          if (chrome.runtime.lastError) {}
        });
      } catch (_) {}
    }
  }

  function sendTrackUpdate(force = false) {
    const track = extractTrackData();
    const trackJson = JSON.stringify(track);

    if (!force && trackJson === lastTrackJson) return;
    lastTrackJson = trackJson;

    if (!track) {
      sendToBackground('CLEAR_TRACK', 'No track active');
      return;
    }

    sendToBackground('TRACK_UPDATE', track);
  }

  window.addEventListener('beforeunload', () => {
    sendToBackground('CLEAR_TRACK', 'Tab closed');
  });

  function initObserver() {
    const playControls = document.querySelector('.playControls') || document.body;
    const observer = new MutationObserver(() => sendTrackUpdate());
    observer.observe(playControls, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-label', 'title', 'style']
    });
  }

  function initSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => sendTrackUpdate(), 1500);
  }

  initObserver();
  initSync();
  sendTrackUpdate(true);
})();
