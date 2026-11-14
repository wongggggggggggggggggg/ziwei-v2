# 紫微斗數 AI 解牌 · v2（改進版）

> 原始設計：[cy55088c-hue/ziwei](https://github.com/cy55088c-hue/ziwei) 的 `ziwei-ai.html`（2026-11-11 快照）
> 本 repo 為改良版：修好 6 個問題、加串流輸出／解讀歷史／下載，並提供「代理模式」讓 API 金鑰不落在前端。

## 直接使用

打開 `https://<你的帳號>.github.io/ziwei-v2/` → 右上齒輪 → 貼上自己的 DeepSeek API 金鑰 → 揀三張牌 → 開始解讀。

> 金鑰只存在你的瀏覽器（預設 sessionStorage，關分頁即失效），只會送往 `api.deepseek.com`。

## 為什麼有「代理模式」

靜態網頁內嵌 API 金鑰 = 公開金鑰（F12 就睇到）。本專案提供 Cloudflare Worker 代理：
金鑰留在 Worker 的加密 secret，前端永遠拿不到。見 `worker/ziwei-proxy-worker.js`、
`docs/04-部署指引.md`、`docs/06-設定步驟與1元方案.md`。

## 目錄

| 路徑 | 用途 |
|------|------|
| `index.html` | 改進版主檔（單檔、零依賴、零金鑰） |
| `worker/ziwei-proxy-worker.js` | Cloudflare Worker 代理（模型白名單、限流、每日上限） |
| `docs/01-安全決策-為什麼唔可以公開內嵌金鑰.md` | 三種金鑰模式比較與風險 |
| `docs/02-對比報告-原版-vs-v2.md` | 逐項列出改了什麼、為什麼 |
| `docs/03-測試清單.md` | 18 項自動測試 + 手動驗證清單 |
| `docs/04-部署指引.md` | Worker + GitHub Pages 部署步驟 |
| `docs/06-設定步驟與1元方案.md` | 官方價格、¥1 可玩幾次、上限方案 |
| `scripts/` | 本機建置腳本（私人版 / 代理版）與離線自測 |

## 主要改動（v2.1.0）

1. 移除 `DEEPSEEK_API_KEY` 硬編碼位
2. 金鑰預設 sessionStorage（可選「記住」）
3. 修正模型名：`deepseek-chat` → `deepseek-flash`（舊名官方公告 2026-07-24 停用）
4. 明確關閉 thinking（官方預設開啟會令 temperature 失效、變慢變貴）
5. 檢查 `finish_reason === "length"`，截斷時顯示警示
6. 429/5xx 自動重試 3 次
7. 加 CSP（`connect-src` 限制）
8. 新增：串流逐字輸出、解讀歷史（20 筆）、下載 .md、代理模式

## 授權

原始作品未宣告授權（預設保留所有權利）。本改良版僅供學習與個人使用，版權屬原作者。
