/**
 * 紫微斗數 AI 解牌 v2 — DeepSeek 代理（Cloudflare Worker）
 *
 * 為什麼要這個檔：靜態網頁內嵌的 API 金鑰，等於公開金鑰（F12 就睇到）。
 * 把金鑰放在 Worker 的環境變數，瀏覽器只會見到 Worker 網址，永遠拿不到金鑰。
 *
 * 部署步驟見：00-索引\05-部署指引.md
 */

// ⚠️ 改成你自己的網域（不要含路徑）。用 "*" 表示任何來源都可以（不建議）。
const ALLOWED_ORIGINS = [
  "https://YOUR-NAME.github.io",
  "http://localhost:8080",
  "http://127.0.0.1:8080"
];

// v2.1：deepseek-chat / deepseek-reasoner 係舊名（官方公告 2026-07-24 起停用）
const ALLOWED_MODELS = ["deepseek-flash", "deepseek-v4-pro"];
const MAX_TOKENS_CAP = 4096;
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 8; // 每個 IP 每分鐘最多 8 次（防被人刷爆你的額度）

// 每日總請求上限（best-effort：Worker isolate 重啟會歸零，真正硬上限係帳戶餘額）
// deepseek-flash 一次解讀約 ¥0.006–0.012 → 40 次 ≈ ¥0.24–0.48，留足緩衝
const DAILY_MAX = 40;
const daily = { date: "", count: 0 };

function dailyGuard() {
  const today = new Date().toISOString().slice(0, 10);
  if (daily.date !== today) {
    daily.date = today;
    daily.count = 0;
  }
  daily.count += 1;
  return daily.count <= DAILY_MAX;
}

const buckets = new Map();

function corsHeaders(origin) {
  const allowAll = ALLOWED_ORIGINS.includes("*");
  const allowed = allowAll || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? (allowAll ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function fail(message, status, origin) {
  return new Response(JSON.stringify({ error: { message: message } }), {
    status: status,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, corsHeaders(origin))
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") {
      return fail("只接受 POST", 405, origin);
    }
    if (!ALLOWED_ORIGINS.includes("*") && !ALLOWED_ORIGINS.includes(origin)) {
      return fail("origin not allowed: " + origin, 403, origin);
    }
    if (!env.DEEPSEEK_API_KEY) {
      return fail("worker 未設定 DEEPSEEK_API_KEY", 500, origin);
    }

    // 簡易限流（每個 isolate 獨立計數，重啟即清空；足夠擋 casual abuse）
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const now = Date.now();
    const bucket = buckets.get(ip) || { start: now, count: 0 };
    if (now - bucket.start > RATE_WINDOW_MS) {
      bucket.start = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(ip, bucket);
    if (bucket.count > RATE_MAX) {
      return fail("請求過於頻繁，請等一分鐘再試。", 429, origin);
    }
    if (!dailyGuard()) {
      return fail("今日解讀額度已用完，請明天再試。", 429, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return fail("body 不是合法 JSON", 400, origin);
    }

    if (!payload || ALLOWED_MODELS.indexOf(payload.model) === -1) {
      return fail("model not allowed", 400, origin);
    }
    if (typeof payload.max_tokens === "number" && payload.max_tokens > MAX_TOKENS_CAP) {
      payload.max_tokens = MAX_TOKENS_CAP;
    }
    delete payload.n; // 不開放一次多個回覆

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
      return fail("連不到 DeepSeek：" + error.message, 502, origin);
    }

    const headers = Object.assign(
      corsHeaders(origin),
      {
        "content-type": upstream.headers.get("content-type") || "application/json"
      }
    );
    if (payload.stream) headers["cache-control"] = "no-store";

    return new Response(upstream.body, { status: upstream.status, headers: headers });
  }
};
