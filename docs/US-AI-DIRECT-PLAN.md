# US Demo (Alex / Handy Works) — "更直接" 改造计划

**作者:** Mavis · **日期:** 2026-08-29 · **状态:** 计划
**目标客户:** Alex 的 Handy Works Home Services（休斯顿，1-3 人维修队）
**目标:** AI 接待员在 **< 30 秒** 内识别问题 + 报价 + 决定，每句 ≤ 15 字

---

## 现状问题（基于现有 system-prompt.md）

读 `vapi/system-prompt.md` 后发现的 5 个低效点：

| 问题 | 现状 | 影响 |
|---|---|---|
| **响应太长** | 每轮 1-2 句（25-40 字）| 客户挂断率上升 |
| **太多礼貌废话** | "Sure! I'd be happy to help" / "I can definitely assist with that" | 浪费 3-5 秒/turn |
| **问题串行** | 一次问一个：issue → zip → details → time → name | 5 turns × 6 秒 = 30 秒 |
| **价格问太晚** | 通常第 3-4 轮才给价格 | 客户已经不耐烦 |
| **服务范围模糊** | "我们做 plumbing"（没说什么是 plumbing）| 客户问题超出范围时 AI 答非所问 |

---

## Part 1 — 语音"更直接"5 个改动

### 1.1 Prompt 改写：每句 ≤ 15 字

**Before:**
> "Sure, I can definitely help you with that. What kind of issue are you having with the plumbing today?"

**After:**
> "Plumbing issue? What's the problem."

**规则：**
- 每轮 1 句（特殊情况最多 2 句）
- 每句 ≤ 15 个英文单词
- 删掉所有 "Sure", "Of course", "I can", "Definitely", "I'd be happy to"
- 不重复客户说的话
- 不说 "thank you for calling" 之类的开场

### 1.2 第一句话直接给信息

**Before:**
> "Hey, this is Alex over at Handy Works Home Services. This call may be recorded for quality. How can I help you today?"

**After:**
> "Handy Works, Alex speaking. What's the issue."

**收益：** 客户第一秒就知道"AI 接待员 + 接听速度"，决策继续还是挂。

### 1.3 问题并行采集

**Before（串行 4 轮）：**
```
AI: What's the issue?
User: Pipe leak
AI: Where are you? (zip)
User: 77005
AI: What time works?
User: Tomorrow morning
AI: Got it, name and callback?
```

**After（1-2 轮搞定）：**
```
AI: What's the issue + zip code?
User: Kitchen pipe leak in 77005
AI: [extract both] 77005, in service. Trip $89 + pipe work $150-400.
    Time tomorrow morning OK? Name + number?
User: Yes, Mike, 713-555-0100
AI: [end_call immediately]
```

**规则：**
- 第一轮同时问 "issue + zip"（两个最重要的）
- 第二轮给价格 + 一次问齐"时间+姓名+电话"
- 第三轮 end_call

### 1.4 价格给得早 + 范围

**Before:**
> AI 收集完所有信息后才给价格

**After:**
> ZIP 一验证完，立刻给 "Trip $89 + [trade] $XXX-XXX. Total大概区间."

**为什么：** 客户打来最关心的 3 件事 = "能不能来 / 多少钱 / 多快到"。前 30 秒没听到价格就开始焦虑。

### 1.5 紧急 / 接受 → 立刻 end_call

**Before:**
> AI: OK got it, anything else I can help?
> User: No thanks
> AI: [end_call]

**After：**
> AI: [end_call immediately after customer says yes/no, no chit-chat]

**收益：** 省 5-10 秒/通，$0.005/通 Vapi 成本降低 ~10%。

---

## Part 2 — 业务流程压缩

### 2.1 4 步 → 3 步

| 旧流程 | 新流程 |
|---|---|
| 1. 识别 issue | 1. 识别 issue + zip（合并）|
| 2. 验证服务范围 | 2. 验证 + 报价格（合并）|
| 3. 问时间 / 姓名 | 3. 一次问齐 + end_call |
| 4. 确认 + end_call | |

**通话时长目标：** 从 60-90 秒 → **< 30 秒**。

### 2.2 Vapi 工具调用更激进

**当前 6 个工具：**
- `check_trade` — 立即调用
- `validate_service` — issue 之后
- `get_price_quote` — validate 之后
- `flag_urgent` — 紧急
- `flag_uncertain` — 不确定
- `end_call` — 结束

**问题：** 工具串行调用，Vapi 多一次 LLM round-trip。

**优化方案：**
1. **合并 `check_trade` 到 `validate_service`**：一次工具调用同时检查 trade + zip
2. **price_quote 自动跟随**：validate 返回 in_service 时，后端直接附加价格，AI 不用再调用

**新工具设计：**
```
check_and_quote(issue_type, zip) → { in_trade, in_service, trip_fee, range_low, range_high, total_low, total_high, currency }
```
1 次调用 = check_trade + validate_service + get_price_quote 全部完成。

### 2.3 Response delay 调到 0

Vapi 设置里：
- `responseDelaySeconds`: 0.5 → **0.3** （更快响应）
- `llmRequestDelaySeconds`: 0.5 → **0.3**
- `silenceTimeoutSeconds`: 30 → **20**（客户沉默 20 秒就主动问）

### 2.4 升级模型到 gpt-4o-mini

`gpt-4o` 对 receptionist 任务过于 powerful，**慢 + 贵**。
- 改用 `gpt-4o-mini`（3-5x 快，10x 便宜）
- 调整 max_tokens: 250 → **80**（强制短回复）
- 调整 temperature: 0.3 → **0.2**（更稳定）

---

## Part 3 — Alex 业务范围细化

### 3.1 已知（系统里有的）

| 项 | 值 |
|---|---|
| 公司 | Handy Works Home Services |
| 老板 | Alex |
| 地址 | 77002 Houston TX |
| 服务半径 | 25 mile |
| 营业时间 | Mon-Fri 9-18, Sat 9-14, Sun closed |
| Trip fee | $89 |
| 距离免费 | 15 mile |
| 距离附加费 | $2/mile |
| Trades | plumbing, electrical, hvac, handyman, general |

### 3.2 必须明确的"能做"清单（每项要写进 prompt）

#### Plumbing ✅
- 水龙头 / sink 漏水 / 更换
- 马桶 / toilet 维修
- 排水管 / drain 堵塞
- 垃圾处理器 / disposal
- 水管 / pipe 漏水（小范围）
- 热水器 / water heater（电热，非燃气）
- 淋浴头 / 淋浴阀

#### Electrical ✅
- 插座 / outlet（GFCI 复位）
- 开关 / switch 更换
- 吊扇 / ceiling fan 安装
- 灯具 / light fixture 更换
- 断路器 / breaker 跳闸复位

#### HVAC ✅
- AC 维修 / 制冷
- 加热 / heating（小范围）
- 滤网更换 / filter 提醒
- 恒温器 / thermostat 调试

#### Handyman ✅
- 家具组装 / IKEA 家具
- 电视挂墙 / TV mount
- 门 / door 修复（合页、锁）
- 油漆 / paint（小范围）
- 干墙补丁 / drywall patch
- 栅栏修复 / fence
- 压力清洗 / pressure washing

#### General ✅
- 搬运 / haul（小件）
- 季节性维护 / 春季秋季 checklist
- 出租房 turn-over（小修小补）

### 3.3 必须明确的"不能做"清单

#### ❌ Roofing（屋顶）
- 任何屋面、瓦片、天沟
- 屋顶漏水 → 推荐屋顶公司

#### ❌ Gas / 燃气
- 燃气热水器、燃气灶、燃气管道
- 燃气泄漏 → **flag_urgent** + 911 提示

#### ❌ 大型 HVAC
- 中央空调整套更换
- 暖通管道安装

#### ❌ 害虫
- 白蚁、蟑螂、蛇
- 害虫控制 → 推荐专业 pest control

#### ❌ 翻新
- 厨房/卫生间整套翻新
- 房屋扩建

#### ❌ 基础结构
- 地基、桩基
- 房屋结构性问题

#### ❌ 智能家居（除非和上面 trade 重叠）
- 单独的智能家居安装（除非要装灯/门锁）
- 网络/IT

### 3.4 价格区间（要写进 prompt）

| Trade | Low ($) | High ($) | 说明 |
|---|---|---|---|
| plumbing | 150 | 400 | 小修 vs 换部件 |
| electrical | 150 | 400 | 同上 |
| hvac | 200 | 500 | 加氟 vs 换压缩机 |
| handyman | 100 | 300 | 1 小时 vs 半天 |
| general | 100 | 300 | 维护类 |

**Trip fee：$89（15 mile 内免费，超出 $2/mile）**

### 3.5 紧急判定标准（必须明确）

| 场景 | 紧急？ | 备注 |
|---|---|---|
| 主管道爆裂 / water everywhere | 🔴 URGENT | 客户先关总阀 |
| 整屋断电（无原因）| 🔴 URGENT | 安全风险 |
| 燃气味 / gas smell | 🔴 URGENT | **让客户先开窗 + 911** |
| 商铺 AC 完全停止 + 有货损风险 | 🔴 URGENT | |
| 老人/小孩无热水 | 🟡 PRIORITY | 不是紧急但要快 |
| 漏水但可控 | 🟢 ROUTINE | 正常排期 |
| 灯泡坏了 | 🟢 ROUTINE | 拼到下次访问 |

### 3.6 FAQ（10-20 条高频问题，需要 Alex 提供）

| 问题 | AI 应答 |
|---|---|
| 你们周末工作吗？| 周六 9-14，周日休息 |
| 要预约多久？| 当天 / 次日（看排期）|
| 估价免费吗？| 上门估价 $89，看完报价再决定修不修 |
| 接受什么付款？| 现金 / 信用卡 / check |
| 保修多久？| 30 天人工保修 |
| 紧急单能马上来吗？| 60-90 分钟内（视距离）|
| 哪些区域你们不来？| 25 mile 内，超出加价 |
| 商业单接吗？| 接，单独议价 |
| ... | ... |

---

## Part 4 — 需要从 Alex 拿到的资料

为了把以上 Part 3 完整填进系统，需要：

### 4.1 必拿（不然 AI 容易答错）

| # | 资料 | 谁问 | 形式 |
|---|---|---|---|
| 1 | 真实价格表（按 trade × 复杂度） | 我帮你问 | 在线表格 |
| 2 | 服务半径内/外报价策略 | 你发给 Alex 问 | 邮件 |
| 3 | 老板手机号（紧急外呼用） | 你 | WhatsApp |
| 4 | 老板 WhatsApp（接工单摘要） | 你 | |
| 5 | 紧急判定阈值确认（哪些算紧急）| 我 | 一次性通话 |
| 6 | 营业时间细节（节假日 / 突发关闭）| 你 | 邮件 |

### 4.2 推荐拿（让 AI 更准）

| # | 资料 | 备注 |
|---|---|---|
| 7 | 常见 10 个问题 + 答案（FAQ） | 一周累积 |
| 8 | 白名单（老客户 / VIP）号码 | 跳过 AI |
| 9 | 黑名单号码（欠款 / 骚扰）| |
| 10 | 录音同意文案（PDPA / TX 一方同意）| |

### 4.3 选拿（v2 优化）

| # | 资料 |
|---|---|
| 11 | 老板真声开场（1-2 分钟 mp3）|
| 12 | 节假日特殊营业 |
| 13 | 季节性高峰（飓风季 / 冬天）|

---

## Part 5 — 实施顺序（5 步，2-3 天可完成）

### Step 1: 重写 US system prompt（半天）

把以上 Part 1 + Part 3 全部塞进 `vapi/system-prompt.md`：
- 每句 ≤ 15 字
- 5 个 in-scope trade 列具体服务
- 7 个 out-of-scope 明确拒绝
- 价格区间直接给
- 紧急判定表

**Deliverable:** 新 system-prompt.md
**验证:** 念 3 个剧本给 Vapi，听响应长度

### Step 2: 合并工具（半天）

把 `check_trade` + `validate_service` + `get_price_quote` 合并为 `check_and_quote`：
- 修改 `src/lib/validation.ts`
- 修改 `vapi/assistant.json` tools
- 修改 `src/app/api/vapi/tools/route.ts` 的 `dispatchToolCall`
- 测试

**Deliverable:** 6 工具 → 4 工具

### Step 3: Vapi 配置优化（30 分钟）

- 模型: gpt-4o → **gpt-4o-mini**
- max_tokens: 250 → **80**
- temperature: 0.3 → **0.2**
- responseDelaySeconds: 0.5 → **0.3**
- llmRequestDelaySeconds: 0.5 → **0.3**
- silenceTimeoutSeconds: 30 → **20**

**Deliverable:** 新 assistant config

### Step 4: 跑 `update-vapi-assistant.js`（5 分钟）

把新 prompt + 工具 + 配置 PATCH 到 Vapi。

### Step 5: 真机测试 3 轮（半天）

3 个测试剧本：
1. **普通 accepted**："Water heater not heating, 77005, morning"
2. **紧急 urgent**："Pipe burst, water everywhere!"
3. **out-of-scope**："I need my roof fixed"

每轮记下：
- AI 响应长度（词数）
- 总通话时长（秒）
- 决策正确性

**目标：< 30 秒通话，< 15 字/句**

---

## Part 6 — 影响估算

| 指标 | 旧 | 新（预计）|
|---|---|---|
| 平均通话时长 | 60-90s | 25-40s |
| 挂断率（30s 内）| ~15% | ~5% |
| AI 响应词数 | 20-30/turn | 8-15/turn |
| 决策错误率 | ~8% | ~3% |
| Vapi 单通成本 | $0.10 | $0.06 |

---

## 待你确认的 3 件事

1. **Part 3.1-3.5 的范围是否准确？** 比如：
   - "不接燃气" 对 Alex 来说真的不接吗？（休斯顿不少维修队也接）
   - "不接大型 HVAC 整套" 准确吗？
   - 价格区间范围 OK 吗？
2. **Part 4 哪些资料你能帮 Alex 问？** 还是让我拟一份问卷发过去？
3. **Part 5 5 步全部执行？** 还是先只做 Step 1-3（不依赖 Alex 资料）跑个 A/B 看效果？

确认后我开始改 system-prompt.md。
