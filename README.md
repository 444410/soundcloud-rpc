# soundcloud-discord-rpc

Shows your currently playing SoundCloud song on your Discord profile from your browser.

## Setup

1. Double-click `start.bat` (or `start_background.vbs` to run it hidden without a terminal window).
2. In your browser (Chrome, Brave, Edge):
   - Go to `chrome://extensions`
   - Turn on **Developer mode** (top right)
   - Click **Load unpacked** (top left)
   - Choose the `extension` folder inside this directory
3. Play music on soundcloud.com.

To stop the background server at any time, run `stop.bat`.

## Settings

Edit `server/config.json`:
- `showButtons`: true/false (adds a link to the song)
- `idleTimeoutSeconds`: how many seconds after pausing before your status clears
