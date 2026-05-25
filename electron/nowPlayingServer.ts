/**
 * Tiny local HTTP server that exposes the current playback state to the
 * Übersicht vk-music widget (and any other local consumer).
 *
 * GET http://127.0.0.1:27182/now-playing
 * → { playing: "playing"|"paused"|"stopped", title, artist, artUrl, provider }
 *
 * Binds only to loopback — never reachable from the network.
 */
import http from 'node:http';
import { getBridgeState } from './widgetBridge.js';

export const NOW_PLAYING_PORT = 27182;

let server: http.Server | null = null;

export function startNowPlayingServer(): void {
  if (server) return;

  server = http.createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/now-playing') {
      res.writeHead(404);
      res.end();
      return;
    }

    const { state, provider } = getBridgeState();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200);

    if (state.kind === 'playing' || state.kind === 'paused') {
      res.end(
        JSON.stringify({
          playing: state.kind,
          title: state.track.title,
          artist: state.track.artists.join(', '),
          artUrl: state.track.album.artUrl ?? '',
          provider,
        }),
      );
    } else {
      res.end(
        JSON.stringify({
          playing: 'stopped',
          title: '',
          artist: '',
          artUrl: '',
          provider,
        }),
      );
    }
  });

  server.listen(NOW_PLAYING_PORT, '127.0.0.1', () => {
    // eslint-disable-next-line no-console
    console.log(`[neon-stereo] widget bridge listening on 127.0.0.1:${NOW_PLAYING_PORT}`);
  });

  server.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn('[neon-stereo] widget bridge error:', err.message);
  });
}

export function stopNowPlayingServer(): void {
  server?.close();
  server = null;
}
