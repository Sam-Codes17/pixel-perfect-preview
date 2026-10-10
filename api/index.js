import server from "../dist/server/server.js";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  // If Vercel invokes with Web Standard Fetch API (single Request parameter)
  if (!res && req && typeof req.text === "function") {
    return await server.fetch(req);
  }

  // If Vercel invokes with Node.js Serverless (IncomingMessage, ServerResponse)
  try {
    const protocol = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
    const url = `${protocol}://${host}${req.url}`;

    const headers = new Headers();
    for (const [key, val] of Object.entries(req.headers)) {
      if (val != null) {
        if (Array.isArray(val)) {
          for (const item of val) headers.append(key, item);
        } else {
          headers.set(key, val);
        }
      }
    }

    let body = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await new Promise((resolve) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
      });
    }

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? body : undefined,
      duplex: "half",
    });

    const webResponse = await server.fetch(webRequest);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const arrayBuffer = await webResponse.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Vercel Serverless Handler Error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html><body><h2>Application Error</h2><p>${err.message}</p></body></html>`);
    }
  }
}
