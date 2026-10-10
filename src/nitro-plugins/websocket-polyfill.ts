/**
 * Nitro startup plugin — runs ONCE at server boot before any request handling.
 * Sets globalThis.WebSocket so that Supabase realtime-js can initialize correctly
 * on Node.js < 22 environments where native WebSocket is absent.
 *
 * On Node.js 22+ this is a no-op because globalThis.WebSocket already exists.
 */
import { WebSocket as WsWebSocket } from "ws";

export default defineNitroPlugin(() => {
  if (typeof globalThis.WebSocket === "undefined") {
    // @ts-expect-error — polyfilling the global with the ws implementation
    globalThis.WebSocket = WsWebSocket;
    console.log("[websocket-polyfill] Polyfilled globalThis.WebSocket with ws package.");
  }
});
