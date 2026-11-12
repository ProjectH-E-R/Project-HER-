const SESSION_COOKIE = "her_sync_session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_HTML_BYTES = 1_500_000;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function safeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sessionSignature(expiry, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(expiry));
  return base64Url(new Uint8Array(bytes));
}

function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  const pair = cookies.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : "";
}

async function hasSession(request, env) {
  const value = cookieValue(request, SESSION_COOKIE);
  const [expiry, signature, extra] = value.split(".");
  if (!expiry || !signature || extra || Number(expiry) <= Math.floor(Date.now() / 1000)) return false;
  const expected = await sessionSignature(expiry, env.SESSION_SECRET);
  return safeEqual(signature, expected);
}

function sameOrigin(request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}

function cookieHeader(value, maxAge) {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function githubHeaders(env) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "project-her-cloudflare-sync",
  };
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function repositoryPath(env) {
  return `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}/contents/index.html`;
}

async function readWebsite(env) {
  const response = await fetch(`${repositoryPath(env)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`, {
    headers: githubHeaders(env),
  });
  if (!response.ok) throw new Error(`GitHub could not load index.html (${response.status}).`);
  const file = await response.json();
  if (file.encoding !== "base64" || typeof file.content !== "string") throw new Error("GitHub returned an unexpected index.html format.");
  return decodeBase64Utf8(file.content);
}

async function saveWebsite(request, env) {
  const { content } = await request.json();
  if (typeof content !== "string" || !content.trimStart().toLowerCase().startsWith("<!doctype html>")) {
    return json({ error: "The page content was not valid HTML." }, 400);
  }
  if (new TextEncoder().encode(content).byteLength > MAX_HTML_BYTES) {
    return json({ error: "The page is too large to save. Try using smaller photos." }, 413);
  }

  const headers = githubHeaders(env);
  const currentResponse = await fetch(`${repositoryPath(env)}?ref=${encodeURIComponent(env.GITHUB_BRANCH || "main")}`, { headers });
  if (!currentResponse.ok) return json({ error: `Could not read the current GitHub file (${currentResponse.status}).` }, 502);
  const current = await currentResponse.json();
  const updateResponse = await fetch(repositoryPath(env), {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Update Project H.E.R. website from editor",
      content: encodeBase64Utf8(content),
      sha: current.sha,
      branch: env.GITHUB_BRANCH || "main",
    }),
  });
  if (!updateResponse.ok) {
    const detail = await updateResponse.json().catch(() => ({}));
    return json({ error: detail.message || `GitHub could not save the page (${updateResponse.status}).` }, 502);
  }
  const result = await updateResponse.json();
  return json({ saved: true, commit: result.commit?.html_url || null });
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (![env.GITHUB_TOKEN, env.SYNC_PASSWORD, env.SESSION_SECRET, env.GITHUB_OWNER, env.GITHUB_REPO].every(Boolean)) {
    if (path.startsWith("/api/") || path.startsWith("/auth/") || path === "/" || path === "/index.html") {
      return new Response("Cloudflare sync is not configured yet. Add the required Worker secrets and variables, then redeploy.", { status: 503 });
    }
  }

  if (path === "/auth/login" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Request origin was rejected." }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.password !== "string" || !safeEqual(body.password, env.SYNC_PASSWORD)) {
      return json({ error: "That sync password is not correct." }, 401);
    }
    const expiry = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    const signature = await sessionSignature(expiry, env.SESSION_SECRET);
    return json({ authenticated: true }, 200, { "Set-Cookie": cookieHeader(`${expiry}.${signature}`, SESSION_SECONDS) });
  }

  if (path === "/auth/logout" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Request origin was rejected." }, 403);
    return json({ loggedOut: true }, 200, { "Set-Cookie": cookieHeader("", 0) });
  }

  if (path === "/api/status" && method === "GET") {
    return json({ authenticated: await hasSession(request, env) });
  }

  if (path === "/api/save" && method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Request origin was rejected." }, 403);
    if (!(await hasSession(request, env))) return json({ error: "Please connect before syncing." }, 401);
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_HTML_BYTES) return json({ error: "The page is too large to save." }, 413);
    try {
      return await saveWebsite(request, env);
    } catch (error) {
      return json({ error: error.message || "GitHub sync failed." }, 502);
    }
  }

  if ((path === "/" || path === "/index.html") && method === "GET") {
    try {
      return new Response(await readWebsite(env), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      });
    } catch (error) {
      return new Response(`Unable to load the site from GitHub: ${error.message}`, { status: 502 });
    }
  }

  return env.ASSETS.fetch(request);
}

export default { fetch: handleRequest };

