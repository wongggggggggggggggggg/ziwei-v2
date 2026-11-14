/**
 * 紫微斗數 AI 解牌 v3 — DeepSeek 代理（Cloudflare Worker）
 *
 * 功能：
 *  - 金鑰只存在 Worker secret，前端永遠拿不到
 *  - 每 IP 每週免費 10 次（WEEKLY_MAX），用完可以輸入解鎖碼 +10 次（UNLOCK_BONUS）
 *  - 解鎖可加 Cloudflare Turnstile 人機驗證（設定 TURNSTILE_SECRET 後自動啟用）
 *  - 有 KV binding（ZWDS_KV）時配額持久；冇就用記憶體（isolate 重啟會歸零）
 *
 * 需要的環境變數／Secret：
 *  DEEPSEEK_API_KEY   必填，DeepSeek 金鑰
 *  UNLOCK_PASSWORD    選填，解鎖碼（例如 tccs）；唔設 = 停用解鎖功能
 *  TURNSTILE_SECRET   選填，Cloudflare Turnstile 的 secret key
 *  ZWDS_KV            選填，KV namespace binding（建議加，配額才持久）
 */

const ALLOWED_ORIGINS = [
  "https://wongggggggggggggggggg.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
];

const ALLOWED_MODELS = ["deepseek-flash", "deepseek-v4-pro"];
const MAX_TOKENS_CAP = 4096;
const WEEKLY_MAX = 10;      // 每人每週免費次數
const UNLOCK_BONUS = 10;    // 每次解鎖：個人 +10
const GLOBAL_WEEKLY_MAX = 40;    // 全站每週總次數（所有 IP 合計），超過即全站封鎖
const GLOBAL_UNLOCK_BONUS = 40;  // 每次解鎖：全站額度 +40（即解鎖一次放行多一輪）
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 6;         // 每 IP 每分鐘最多 6 次（防瞬時爆發）

const memQuota = new Map();
const memGlobal = new Map();
const memRate = new Map();

/* ---------------- CORS / 回應 ---------------- */
function corsHeaders(origin) {
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "content-type, x-request-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}

function fail(message, status, origin, code) {
  return json({ error: { message, code: code || "error" } }, status, origin);
}

/* ---------------- 每週配額 ---------------- */
function weekKey(now) {
  const d = new Date(typeof now === "number" ? now : Date.now());
  const day = (d.getUTCDay() + 6) % 7;          // 星期一 = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);           // 用「本週星期一」做 key
}

async function readQuota(env, ip) {
  const key = "q:" + weekKey() + ":" + ip;
  if (env.ZWDS_KV) {
    const raw = await env.ZWDS_KV.get(key, "json");
    return raw || { used: 0, bonus: 0 };
  }
  return memQuota.get(key) || { used: 0, bonus: 0 };
}

async function writeQuota(env, ip, value) {
  const key = "q:" + weekKey() + ":" + ip;
  if (env.ZWDS_KV) {
    await env.ZWDS_KV.put(key, JSON.stringify(value), { expirationTtl: 14 * 86400 });
    return;
  }
  memQuota.set(key, value);
}

/* ---------------- 全站每週總額 ---------------- */
async function readGlobal(env) {
  const key = "g:" + weekKey();
  if (env.ZWDS_KV) {
    const raw = await env.ZWDS_KV.get(key, "json");
    return raw || { used: 0, bonus: 0 };
  }
  return memGlobal.get(key) || { used: 0, bonus: 0 };
}

async function writeGlobal(env, value) {
  const key = "g:" + weekKey();
  if (env.ZWDS_KV) {
    await env.ZWDS_KV.put(key, JSON.stringify(value), { expirationTtl: 14 * 86400 });
    return;
  }
  memGlobal.set(key, value);
}

function maskIp(ip) {
  const text = String(ip || "");
  if (text.indexOf(":") !== -1) {
    const parts = text.split(":");
    return parts.slice(0, 3).join(":") + ":****";
  }
  const parts = text.split(".");
  if (parts.length === 4) return parts[0] + "." + parts[1] + "." + parts[2] + ".*";
  return text || "unknown";
}

/* ---------------- 限流（固定窗口） ---------------- */
function rateOk(bucketKey, max, windowMs) {
  const now = Date.now();
  const b = memRate.get(bucketKey) || { start: now, count: 0 };
  if (now - b.start > windowMs) { b.start = now; b.count = 0; }
  b.count += 1;
  memRate.set(bucketKey, b);
  return b.count <= max;
}

/* ---------------- Turnstile ---------------- */
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: "缺少人機驗證 token" };
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", String(token));
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const data = await res.json();
    if (!data.success) {
      return { ok: false, error: (data["error-codes"] || []).join(",") || "siteverify 回 success=false" };
    }
    // canonical 檢查：action 與 hostname 都要符合，否則等於 token 被挪用
    if (data.action && data.action !== "unlock") {
      return { ok: false, error: "action 不符：" + data.action };
    }
    const hosts = ["wongggggggggggggggggg.github.io", "localhost", "127.0.0.1"];
    if (data.hostname && hosts.indexOf(data.hostname) === -1) {
      return { ok: false, error: "hostname 不符：" + data.hostname };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "驗證服務連不上" };
  }
}

/* ---------------- 常數時間比對 ---------------- */
function safeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") || "unknown";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!ALLOWED_ORIGINS.includes("*") && !ALLOWED_ORIGINS.includes(origin)) {
      return fail("origin not allowed: " + origin, 403, origin, "origin");
    }

    /* ---- 查詢配額 ---- */
    if (request.method === "GET" && url.pathname === "/quota") {
      const q = await readQuota(env, ip);
      const g = await readGlobal(env);
      const limit = WEEKLY_MAX + (q.bonus || 0);
      const globalLimit = GLOBAL_WEEKLY_MAX + (g.bonus || 0);
      return json({
        ok: true,
        week: weekKey(),
        ip: maskIp(ip),
        used: q.used,
        bonus: q.bonus || 0,
        limit,
        remaining: Math.max(0, limit - q.used),
        weeklyMax: WEEKLY_MAX,
        unlockBonus: UNLOCK_BONUS,
        globalUsed: g.used,
        globalBonus: g.bonus || 0,
        globalLimit,
        globalRemaining: Math.max(0, globalLimit - g.used),
        globalWeeklyMax: GLOBAL_WEEKLY_MAX,
        globalBlocked: g.used >= globalLimit,
        unlockEnabled: Boolean(env.UNLOCK_PASSWORD),
        turnstileEnabled: Boolean(env.TURNSTILE_SECRET)
      }, 200, origin);
    }

    if (request.method !== "POST") return fail("只接受 POST", 405, origin, "method");

    /* ---- 解鎖碼 ---- */
    if (url.pathname === "/unlock") {
      if (!env.UNLOCK_PASSWORD) return fail("伺服器未啟用解鎖功能", 503, origin, "unlock_disabled");
      if (!rateOk("unlock:" + ip, 5, 600000)) {
        return fail("嘗試次數過多，請 10 分鐘後再試。", 429, origin, "unlock_rate");
      }
      let body = null;
      try { body = await request.json(); } catch (error) { body = null; }

      const turnstileToken = body && (body["cf-turnstile-response"] || body.turnstileToken);
      const ts = await verifyTurnstile(env, turnstileToken, ip);
      if (!ts.ok) return fail("人機驗證失敗" + (ts.error ? "（" + ts.error + "）" : ""), 400, origin, "turnstile");

      if (!safeEqual((body && body.password) || "", env.UNLOCK_PASSWORD)) {
        return fail("解鎖碼不正確", 403, origin, "bad_password");
      }

      const q = await readQuota(env, ip);
      q.bonus = (q.bonus || 0) + UNLOCK_BONUS;
      await writeQuota(env, ip, q);

      const g = await readGlobal(env);
      g.bonus = (g.bonus || 0) + GLOBAL_UNLOCK_BONUS;
      await writeGlobal(env, g);

      const limit = WEEKLY_MAX + q.bonus;
      const globalLimit = GLOBAL_WEEKLY_MAX + g.bonus;
      return json({
        ok: true,
        bonus: q.bonus, used: q.used, limit, remaining: Math.max(0, limit - q.used),
        globalBonus: g.bonus, globalLimit, globalRemaining: Math.max(0, globalLimit - g.used)
      }, 200, origin);
    }

    /* ---- 對話 ---- */
    if (url.pathname !== "/chat") return fail("not found", 404, origin, "path");
    if (!env.DEEPSEEK_API_KEY) return fail("Worker 未設定 DEEPSEEK_API_KEY", 500, origin, "no_key");

    if (!rateOk("chat:" + ip, RATE_MAX, RATE_WINDOW_MS)) {
      return fail("請求太頻繁，請一分鐘後再試。", 429, origin, "rate");
    }

    const globalState = await readGlobal(env);
    const globalLimit = GLOBAL_WEEKLY_MAX + (globalState.bonus || 0);
    if (globalState.used >= globalLimit) {
      return fail(
        "本週全站次數已用完（" + globalLimit + " 次）。輸入解鎖碼可即時恢復（每次 +" +
          GLOBAL_UNLOCK_BONUS + " 次），或由站長在 Cloudflare 調整。",
        429, origin, "global_blocked"
      );
    }

    const quota = await readQuota(env, ip);
    const limit = WEEKLY_MAX + (quota.bonus || 0);
    if (quota.used >= limit) {
      return fail(
        "本週免費次數已用完（" + limit + " 次）。輸入解鎖碼可再加 " + UNLOCK_BONUS + " 次。",
        429, origin, "quota_exhausted"
      );
    }

    let payload = null;
    try { payload = await request.json(); } catch (error) { payload = null; }
    if (!payload || ALLOWED_MODELS.indexOf(payload.model) === -1) {
      return fail("model not allowed", 400, origin, "model");
    }
    if (typeof payload.max_tokens === "number" && payload.max_tokens > MAX_TOKENS_CAP) {
      payload.max_tokens = MAX_TOKENS_CAP;
    }
    delete payload.n;

    quota.used += 1;
    await writeQuota(env, ip, quota);

    globalState.used += 1;
    await writeGlobal(env, globalState);

    let upstream;
    try {
      upstream = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + env.DEEPSEEK_API_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      return fail("連不到 DeepSeek：" + error.message, 502, origin, "upstream");
    }

    const headers = Object.assign(corsHeaders(origin), {
      "content-type": upstream.headers.get("content-type") || "application/json",
      "x-quota-remaining": String(Math.max(0, limit - quota.used)),
      "x-global-remaining": String(Math.max(0, globalLimit - globalState.used))
    });
    if (payload.stream) headers["cache-control"] = "no-store";

    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
