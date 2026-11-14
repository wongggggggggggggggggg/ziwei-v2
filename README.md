# 🔮 紫微斗數 AI 解牌 · v2

用三張牌（主星 · 輔星 · 十二長生）換一段專屬解讀 —— **單一 HTML 檔、零依賴、零建置**，由 DeepSeek 生成。

> 原始設計：[cy55088c-hue/ziwei](https://github.com/cy55088c-hue/ziwei) 的 `ziwei-ai.html`（2026-11-11 快照）
> 這個版本修好了 6 個問題，並加上串流輸出、解讀紀錄、下載與「免金鑰」代理模式。

---

## 🚀 立即使用（兩個版本，選一個）

| 版本 | 網址 | 需要 API 金鑰？ | 適合誰 |
|------|------|----------------|--------|
| **① 免金鑰版（代理）** | **<https://wongggggggggggggggggg.github.io/ziwei-v2/>** | ❌ **不用** | 想直接玩、不想申請帳號的人 |
| **② 自備金鑰版（BYOK）** | <https://wongggggggggggggggggg.github.io/ziwei-v2/byok.html> | ✅ 要自己的 | 想用自己額度、或自己 fork 部署的人 |

兩頁底部都有連結可互相切換。

### 怎麼用（4 步）
1. 打開上面任一網址
2. 依序點：**一張主星** → **一顆輔星** → **一個十二長生**（再點同一張可取消）
3. 按 **「開始解讀」** → 文字會**逐字浮現**（串流），約 10–30 秒
4. 完成後可以 **複製** / **下載 .md** / 在 **歷史** 裡找回之前 20 次紀錄

> ✨ 趕時間？按 **「隨機抽牌」** 讓它幫你抽三張。

---

## 🔐 關於 API 金鑰（重要）

### 版本①（代理）
- 你的瀏覽器**完全不會接觸** API 金鑰。
- 請求會送到作者的 Cloudflare Worker，由伺服器代為呼叫 DeepSeek。
- 為了避免被濫用，Worker 有兩層限制：**每個 IP 每分鐘 8 次**、**每日 40 次**。
- 額度用完會顯示「今日解讀額度已用完」——這是刻意的，不是壞掉。

### 版本②（BYOK：Bring Your Own Key）
- 金鑰**只存在你自己的瀏覽器**：預設存在 `sessionStorage`（關閉分頁即失效）；
  勾選「記住金鑰」才寫入 `localStorage`。
- 只會傳送到 `api.deepseek.com`（頁面已用 CSP `connect-src` 限制，其他網域收不到）。
- 兌換/申請：<https://platform.deepseek.com/api_keys>
- **不要在公共電腦勾「記住金鑰」**；用完可按「清除金鑰」。

> ⚠️ 為什麼不做「把金鑰寫進網頁」的版本？
> 靜態網頁內嵌金鑰 = 公開金鑰（F12 兩秒就拿到）。詳見 [docs/01](docs/01-安全決策-為什麼唔可以公開內嵌金鑰.md)。

---

## 💰 費用大概多少

用 `deepseek-flash`：一次解讀約 **¥0.006–0.012**（人民幣），所以 ¥1 大約可以玩 **80 次**。
價格與高峰期時段（香港時間 09:00–12:00、14:00–18:00 為高峰價）詳見 **[docs/06](docs/06-設定步驟與1元方案.md)**。

---

## 🛠 想自己部署一份？

1. **Worker 代理**：把 `worker/ziwei-proxy-worker.js` 貼到 Cloudflare Workers，
   設 Secret `DEEPSEEK_API_KEY`、把 `ALLOWED_ORIGINS` 改成你的網域 → 見 [docs/04](docs/04-部署指引.md)
2. **前端**：把 `index.html` 的 `CONFIG.PROXY_URL` 改成你的 Worker 網址（或留空 = BYOK 模式）
3. **上架**：丟到 GitHub Pages / 任何靜態空間即可

> 完全不需要 npm、build、框架。一個檔案就是整個網站。

---

## 📁 目錄

| 路徑 | 說明 |
|------|------|
| `index.html` | 免金鑰版（代理） |
| `byok.html` | 自備金鑰版 |
| `worker/ziwei-proxy-worker.js` | Cloudflare Worker 代理（模型白名單、限流、每日上限） |
| `docs/01` | 三種金鑰模式的風險比較 |
| `docs/02` | 原版 vs 本版：逐項改動與原因 |
| `docs/03` | 測試清單（18 項自動測試 + 手動檢查） |
| `docs/04` | Cloudflare Worker + GitHub Pages 部署指引 |
| `docs/06` | 官方價格、¥1 方案、上限設計 |
| `scripts/` | 本機建置腳本（私人版／代理版）與離線自測 `selftest.mjs` |

---

## ✨ v2.1.0 改了什麼

1. 移除 `DEEPSEEK_API_KEY` 硬編碼位（原版最大風險）
2. 金鑰預設只存 sessionStorage，可選「記住」
3. **修正模型名** `deepseek-chat` → `deepseek-flash`（舊名官方公告 2026-07-24 停用）
4. 明確關閉 thinking（官方預設開啟會令 temperature 失效、變慢、變貴）
5. 檢查 `finish_reason === "length"`，被截斷時顯示警示
6. 429 / 5xx / 逾時 **自動重試 3 次**
7. 加入 CSP（限制連線目的地）
8. 新增：**串流逐字輸出**、**解讀紀錄（20 筆）**、**下載 .md**、**代理模式**、**公開網址＋內嵌金鑰自動示警**

原版 46,960 字元的 CSS、七段 prompt、24 個雙星配對、十二長生順序 **完全保留**。

---

## ❓ FAQ

**Q：解讀準不準？**
A：這是「以牌卡為媒介的自我探索工具」，不是命理預測。系統 prompt 明確要求避免恐嚇與宿命論。

**Q：會保存我的解讀嗎？**
A：只存在你自己的瀏覽器（`zwds.history`，最多 20 筆），可按「刪除」清掉。伺服器不保存。

**Q：為什麼有時候很慢？**
A：DeepSeek 在高峰時段較慢；另外長回覆約需 10–30 秒。串流會讓你先看到開頭。

**Q：可以商用／改造嗎？**
A：原始作品未宣告授權（預設保留所有權利）。本改良版僅供學習與個人使用，版權屬原作者。

---

## 🙏 出處

- 原始設計與牌組資料：**[cy55088c-hue/ziwei](https://github.com/cy55088c-hue/ziwei)**
- 模型：DeepSeek（`deepseek-flash`）
- 代理：Cloudflare Workers
