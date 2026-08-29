# US Demo (Alex) — 端到端测试计划

**目标:** 验证新版"更直接"AI 接待员在实际电话里的表现
**测试环境:** Vapi assistant `42523b3e-...` + Vercel 部署 `https://demo-navy-chi-47.vercel.app/`
**测试电话:** US +1 724 362 0422（Alex 的 Vapi 号码）

---

## 前置步骤

### 0.1 Vercel 重新部署（重要）

之前的 Vercel 项目可能处于暂停状态（因为 private repo 改 public 时的状态）。

**操作：**
1. 打开 https://vercel.com/dashboard
2. 找 `demo` project
3. 如果显示 "Paused"：点 **Resume** 按钮
4. 等待 1-2 分钟，URL 恢复

**验证：**
```bash
curl -sI https://demo-navy-chi-47.vercel.app/ | head -2
# 应该看到 HTTP/2 200
```

### 0.2 准备测试设备

- 1 部手机（打 Vapi 号码）
- 1 部电脑（看 /api/admin/llm-stats 实时统计）
- 1 个秒表（手动测通话时长）

### 0.3 工具

- **AI 接待员：** +1 (724) 362-0422
- **看实时 dashboard：** https://demo-navy-chi-47.vercel.app/?country=us
- **看 LLM 统计：** https://demo-navy-chi-47.vercel.app/api/admin/llm-stats (header: `x-admin-token: dev-secret`)

---

## 测试目标

每通电话打完后立刻评分（5 分制）：

| 维度 | 1 分 | 5 分 |
|---|---|---|
| 通话时长 | > 60 秒 | < 30 秒 |
| AI 响应句数 | > 4 句 | ≤ 2 句 |
| 单句词数 | > 25 词 | ≤ 15 词 |
| 礼貌废话 | "Sure thing" 等 | 0 |
| 信息采集 | 漏掉 zip / 时间 / 姓名 | 全齐 |
| 价格给得 | 通话结束才给 | ZIP 一验证就给 |
| 决策正确 | 错 | 对 |

**目标总分 ≥ 30/35（每通都过）**

---

## 5 个测试剧本

### 剧本 1：普通 accepted（水管漏水）

**通话内容：**
```
你：Hi, I have a kitchen sink that's leaking
AI：[应该在 5 秒内说 "What's your zip."]
你：77005
AI：[应该立刻说 "77005, in service. Trip $89, plumbing $150-400, total大概 $240-490. When works — morning or afternoon? Name + number?"]
你：Tomorrow morning. Mike, 713-555-0100
AI：[应该立刻说 "Got it, Mike. Alex calls to confirm. Bye." 然后 end_call]
```

**预期结果：**
- 通话时长：< 30 秒
- AI 句数：3 句（第 1 句问 zip，第 2 句给价格+问时间+姓名，第 3 句结束）
- 决策：accepted
- Dashboard：1 条新工单，customer_name=Mike，issue_type=plumbing

**评分：**
- 通话时长 ____ 秒
- AI 句数 ____
- 评分 ____/35

---

### 剧本 2：紧急 urgent（主管道爆裂）

**通话内容：**
```
你：My pipe just burst! Water everywhere in my kitchen!
AI：[应该立刻说 "Stay safe. Alex calls back in 5-15 minutes. Bye." 然后 flag_urgent + end_call]
```

**预期结果：**
- 通话时长：< 15 秒
- AI 句数：1-2 句
- 决策：urgent
- 你手机会在 30 秒内接到 AI 紧急外呼电话（+1 512 712 6713）
- Dashboard：1 条工单 ai_decision=urgent

**评分：**
- 通话时长 ____ 秒
- 紧急外呼收到？____
- 评分 ____/35

---

### 剧本 3：Gas smell（最高级别紧急）

**通话内容：**
```
你：I smell gas in my house! It's strong!
AI：[应该立刻说 "Open windows, leave the house, call 911. Alex calls back. Bye." 然后 flag_urgent + end_call]
```

**预期结果：**
- AI 必须说"open windows + 911"安全提示
- 通话时长：< 15 秒
- 决策：urgent
- 紧急外呼 + SMS 给你

**评分：**
- AI 提到 911？____
- AI 提到开窗？____
- 评分 ____/35

---

### 剧本 4：超出服务范围（Dallas）

**通话内容：**
```
你：Hey, I need someone to fix my water heater. I'm in 75201 (Dallas).
AI：[应该立刻说 "Outside our 25 mile Houston radius. Try a local contractor. Anything else?" 然后 end_call]
```

**预期结果：**
- 通话时长：< 20 秒
- AI 句数：1-2 句
- 决策：rejected
- 原因：zip 超出服务范围

**评分：**
- AI 明确说"outside our service area"？____
- AI 推荐其他？____
- 评分 ____/35

---

### 剧本 5：out-of-scope（pest control）

**通话内容：**
```
你：I have termites in my house. Can you help?
AI：[应该说 "Sorry, pest control is outside our scope. Try a pest control service. Have a good day." 然后 end_call]
```

**预期结果：**
- 通话时长：< 20 秒
- AI 句数：1-2 句
- 决策：rejected
- 原因：trade 不在 list

**评分：**
- AI 礼貌拒绝？____
- 推荐其他服务？____
- 评分 ____/35

---

### 剧本 6（bonus）：想要真人

**通话内容：**
```
你：I need to talk to a real person, not a bot.
AI：[应该说 "No problem, Alex will call you back. Thanks for your patience." 然后 flag_uncertain + end_call]
```

**预期结果：**
- 通话时长：< 15 秒
- 决策：unsure
- Alex 收到 callback 提示

---

## 评分汇总表

| 剧本 | 目标时长 | 实际时长 | AI 句数 | 决策 | 总分 |
|---|---|---|---|---|---|
| 1. 漏水 | < 30s | | | accepted | /35 |
| 2. 爆裂 | < 15s | | | urgent | /35 |
| 3. Gas | < 15s | | | urgent | /35 |
| 4. Dallas | < 20s | | | rejected | /35 |
| 5. 害虫 | < 20s | | | rejected | /35 |
| 6. 真人 | < 15s | | | unsure | /35 |

---

## 评分后做这 4 件事

1. **截图每通电话的 dashboard 行**（确认数据写入）
2. **记下 AI 哪里说"对/错"了**
3. **看 /api/admin/llm-stats** 的 LLM 成本（应该比之前低，因为用 gpt-4o-mini）
4. **听紧急外呼录音**（如果收到）

---

## 常见问题排查

### AI 响应太长？

→ 检查 Vapi 里的 `maxTokens` 是否为 80。`scripts/update-vapi-assistant.js` 会 PATCH 这个值。

### AI 没给价格就 end_call？

→ 检查是否在 ZIP 之前就 end_call。重启对话，从 ZIP 重新开始。

### 紧急外呼没收到？

→ 1) 检查 Vapi assistant `serverUrl` 是否为 `https://demo-navy-chi-47.vercel.app/api/vapi/tools`  2) 检查 Vercel project 是否运行  3) 你的紧急手机号 +1 512 712 6713 是否能在工作时间接到

### Dashboard 不显示新通话？

→ 1) 看 /api/admin/llm-stats 有没有 LLM 调用记录  2) 看 Supabase work_orders 表  3) 检查 webhook 是否到达（看 Vercel logs）

---

## 录音回放

每通电话的录音会自动保存到 Supabase Storage。查看方式：

1. Dashboard → 点工单行 → 看详情页
2. 直接查：https://demo-navy-chi-47.vercel.app/orders/[id]

---

## 完整测试跑完后告诉我

- 6 通电话的总分
- 哪些剧本 AI 表现好
- 哪些需要调 prompt
- 紧急外呼是否真的打过来
- 通话时长平均（vs 旧的 60-90 秒）

我根据结果调 prompt 第二版（如果需要），然后就可以让 H-Master 真实测试了。
