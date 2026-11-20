import { createServer } from "node:http";
import { readFileSync } from "node:fs";
export function serve(csp) {
  const html = `<!doctype html><meta charset=utf-8><script src="/.build/v024.js"></script><script src="/.build/v025.js"></script><script src="/.build/vnew.js"></script><script src="/page.js"></script>`;
  const server = createServer((req, res) => {
    const headers = csp ? { "Content-Security-Policy": csp } : {};
    if (req.url === "/") { res.writeHead(200, { "content-type": "text/html", ...headers }); return res.end(html); }
    try {
      const body = readFileSync(new URL("." + req.url, import.meta.url));
      res.writeHead(200, { "content-type": "text/javascript", ...headers }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}
