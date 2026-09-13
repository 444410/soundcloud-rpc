const SERVER_URL = 'http://127.0.0.1:3020';

async function updateStatus() {
  const serverBadge = document.getElementById('server-badge');
  const discordStatus = document.getElementById('discord-status');
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackTime = document.getElementById('track-time');
  const trackArt = document.getElementById('track-art');

  try {
    const res = await fetch(`${SERVER_URL}/status`);
    if (!res.ok) throw new Error('Bad response');
    const data = await res.json();

    serverBadge.textContent = 'Server Online';
    serverBadge.className = 'badge badge-online';

    if (data.discordReady) {
      discordStatus.textContent = 'Connected & Active';
      discordStatus.style.color = '#23a55a';
    } else if (data.discordConnected) {
      discordStatus.textContent = 'Pipe Connected';
      discordStatus.style.color = '#f0b232';
    } else {
      discordStatus.textContent = 'Discord Not Detected';
      discordStatus.style.color = '#f23f43';
    }

    if (data.lastTrack) {
      const t = data.lastTrack;
      trackTitle.textContent = t.title || 'Untitled';
      trackArtist.textContent = (t.playing ? '▶ ' : '⏸ ') + (t.artist || 'Unknown Artist');
      
      const curM = Math.floor((t.currentTime || 0) / 60);
      const curS = Math.floor((t.currentTime || 0) % 60).toString().padStart(2, '0');
      const durM = Math.floor((t.duration || 0) / 60);
      const durS = Math.floor((t.duration || 0) % 60).toString().padStart(2, '0');
      trackTime.textContent = t.duration ? `${curM}:${curS} / ${durM}:${durS}` : `${curM}:${curS}`;

      if (t.artwork) {
        trackArt.src = t.artwork;
      }
    } else {
      trackTitle.textContent = 'No track playing';
      trackArtist.textContent = 'Play music on SoundCloud';
      trackTime.textContent = '--:-- / --:--';
    }
  } catch (err) {
    serverBadge.textContent = 'Server Offline';
    serverBadge.className = 'badge badge-offline';
    discordStatus.textContent = 'Server unreachable';
    discordStatus.style.color = '#f23f43';
  }
}

document.getElementById('btn-refresh').addEventListener('click', updateStatus);
document.getElementById('btn-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: `${SERVER_URL}/` });
});

document.addEventListener('DOMContentLoaded', updateStatus);
