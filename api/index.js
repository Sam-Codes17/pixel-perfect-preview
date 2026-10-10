import server from "../dist/server/server.js";

export const config = {
  runtime: "edge",
};

export default async function handler(request) {
  try {
    return await server.fetch(request);
  } catch (err) {
    console.error("Vercel Edge Handler error:", err);
    return new Response(
      `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;"><h2>RIFT Bank Error</h2><p>${err.message}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}
