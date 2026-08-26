# HandyLine AI MVP 计划 — 给初期合作客户使用

**作者:** Mavis (mavis) · **日期:** 2026-08-26 · **状态:** 草稿 v0.1
**目标客户:** H-Master Security Services（第一位）+ 接下来 3-5 家早期客户
**时间窗:** 8-10 周到 GA（General Availability）

---

## 0. 现状盘点

| 项 | 现状 | MVP 差距 |
|---|---|---|
| 数据库 | Supabase Postgres + 11 migrations | ✅ 够用 |
| 业务层 | Vapi + Twilio + Next.js + Vercel | ✅ 够用 |
| 多区域 | US + MY 路由 | ✅ 已支持 |
| LLM 摘要 | gpt-4o-mini + 缓存 + 成本监控 | ✅ 够用 |
| 客户数据 | 86 条（75 US + 11 MY demo） | ⚠️ demo 数据，不是真客户 |
| 鉴权 | **完全没有** | ❌ 任何人都能看所有数据 |
| 多租户 | DB 结构支持但代码不隔离 | ❌ 共享 dashboard |
| 自助注册 | 无 | ❌ 销售人工配 |
| 支付 / 计费 | 无 | ❌ 不知道收谁钱 |
| 合规 | 无 Privacy Policy / ToS | ❌ 不能签客户合同 |
| 监控 / 报警 | Vercel + Supabase 默认 | ⚠️ 无主动报警 |
| 备份 | Supabase 自动 | ⚠️ 未验证 RPO/RTO |
| 域名 | `demo-navy-chi-47.vercel.app` | ❌ 给客户看的不能是 vercel 子域 |

---

## 1. MVP 定义

**For:** 1-5 个早期合作客户（已经 sales-led 谈下来）
**Do:**
- 每个客户独立工作区（数据隔离）
- 老板登录后看到自己的通话 + 录音 + 摘要
- 我们（平台方）admin 后台看全局
- 真实号码 + 真实语音 + 真实工单
- 基本可靠性（99%+ uptime，重试有保障）
- 基础合规（PDPA / CCPA / 录音告知）

**Don't (P0 不做):**
- 自助注册
- 自助配置（admin 帮客户配）
- 支付系统（线下签合同 + 银行转账）
- 多语种（先英文）
- 多老板账号（每个客户 1 个老板）
- 客户回访外呼
- 移动 App
- 自托管

---

## 2. 架构改动（demo → MVP）

### 2.1 鉴权层（全新）

**方案：Supabase Auth + 邮箱密码登录**

```
src/app/
├── (auth)/
│   ├── login/page.tsx           # 老板登录
│   ├── reset/page.tsx           # 密码重置
│   └── layout.tsx
├── (admin)/
│   ├── admin/
│   │   ├── page.tsx              # 平台 dashboard
│   │   ├── customers/page.tsx    # 客户列表
│   │   ├── llm-stats/page.tsx    # LLM 成本
│   │   └── vapi-spend/page.tsx   # Vapi 消费
│   └── layout.tsx
├── (boss)/
│   ├── dashboard/                # 老板看自己的工单
│   │   ├── page.tsx
│   │   ├── orders/[id]/page.tsx
│   │   └── recordings/page.tsx
│   └── layout.tsx
└── api/
    ├── auth/...
    └── ...
```

**Supabase RLS 策略：**
- `bosses`: 自己只能看自己 (`auth.uid() = owner_user_id`)
- `work_orders`: 自己 boss_id 的单
- `customers`: 自己 boss_id 的
- `call_events`: 自己 boss_id 的

### 2.2 数据模型补充

需要新增的表：

```sql
-- 用户（老板账号）
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,            -- Supabase Auth 管
  full_name TEXT,
  boss_id UUID REFERENCES bosses(id),  -- 关联到 boss
  role TEXT DEFAULT 'boss',      -- 'boss' | 'admin' | 'staff'
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 客户订阅（基础版）
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  boss_id UUID REFERENCES bosses(id) UNIQUE,
  plan TEXT DEFAULT 'trial',     -- 'trial' | 'starter' | 'pro' | 'enterprise'
  monthly_call_limit INT,
  monthly_call_used INT DEFAULT 0,
  status TEXT DEFAULT 'active',  -- 'active' | 'paused' | 'cancelled'
  started_at TIMESTAMPTZ DEFAULT now(),
  renews_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 工单状态变更日志
CREATE TABLE work_order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID REFERENCES work_orders(id),
  event TEXT,                    -- 'created' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'
  actor TEXT,                    -- 'ai' | 'boss' | 'customer' | 'system'
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 2.3 业务流程改动

**Onboarding（新客户）：**
1. Sales 谈下来，签合同
2. Admin 在 `/admin/customers` 创建客户
   - 输入公司名、地址、营业时间、价格表、紧急规则
   - 选 plan（trial / starter / pro）
3. 系统自动：
   - 创建 `users` 行 + 临时密码
   - 创建 `subscriptions` 行
   - 创建 `bosses` 行（已有逻辑）
   - 通过 Vapi API 买 +60/+1 号码
   - 通过 Vapi API 创建 assistant + 写 system prompt
   - 绑 number → assistant
   - 发送 welcome email 给老板
4. Admin 验证：用一个测试电话打过去，确认 AI 接听正常

**来电流转：**
1. 客户拨 Vapi 号码
2. Vapi 找到对应 assistant（每个客户一个）
3. AI 用客户的 system prompt + 工具接听
4. 工具调用走同一个 endpoint，但 `getBossByCountry` 改为 `getBossByVapiAssistantId`（更精确）
5. 通话结束 → webhook → 写 work_order → 推送给老板

**老板工作流：**
1. 老板收到 push（SMS / WhatsApp / Email）
2. 老板登录 `/dashboard` 看摘要
3. 老板点 "确认" / "改时间" / "拒绝" / "回拨"
4. 状态变更写 `work_order_events` + 推回 EMS（如已集成）

---

## 3. UI/UX 改动

### 3.1 当前 `/` → 拆为 3 个入口

| 路径 | 谁 | 看到什么 |
|---|---|---|
| `/login` | 老板 | 登录表单 |
| `/dashboard` | 老板 | 自己的工单列表 + 录音 |
| `/admin` | 平台方 | 全局 dashboard + 客户管理 + 成本监控 |
| `/` | 公开 | redirect 到 `/login`（未登录）或 `/dashboard`（已登录） |

### 3.2 老板 dashboard 最小集

```
┌────────────────────────────────────┐
│ [Logo] H-Master Service Desk   [⚙] │
├────────────────────────────────────┤
│ Stats                              │
│ [Today: 5 calls] [Urgent: 1]       │
│ [Pending: 3] [Completed: 12]      │
├────────────────────────────────────┤
│ Work Orders         [Filter ▾]     │
│ ┌──────────────────────────────┐  │
│ │ 🟠 URGENT  Alarm triggered   │  │
│ │ Ahmad Razali · 97008 Bintulu  │  │
│ │ 5 min ago · [Listen] [Call]   │  │
│ └──────────────────────────────┘  │
│ ┌──────────────────────────────┐  │
│ │ ✅ ACCEPTED  CCTV install    │  │
│ │ ...                           │  │
│ └──────────────────────────────┘  │
└────────────────────────────────────┘
```

### 3.3 录音回放 + AI 摘要

每个工单详情页：
- 客户信息（phone, name, address）
- 通话录音（HTML5 audio + 波形图）
- AI 摘要（gpt-4o-mini 提取的 name/intent/tendency/follow-up）
- 价格（trip fee + 范围 + 紧急度）
- 老板操作：Confirm / Reschedule / Reject / Callback

---

## 4. 实施分阶段（10 周）

### Phase 1：基础设施（1 周）

| # | 事项 | 时间 |
|---|---|---|
| 1.1 | 买域名 `handyline.bookloh.com`（如有） | 半天 |
| 1.2 | Vercel custom domain + SSL | 1 小时 |
| 1.3 | Sentry 集成（错误监控） | 2 小时 |
| 1.4 | Better Uptime / Instatus（uptime 监控） | 1 小时 |
| 1.5 | Privacy Policy + Terms of Service 页面 | 1 天 |
| 1.6 | Supabase backup 验证 + 文档 | 半天 |

**里程碑：** 域名上线 + 监控可观察

### Phase 2：鉴权 + 客户隔离（1.5 周）

| # | 事项 | 时间 |
|---|---|---|
| 2.1 | Supabase Auth + 邮箱密码登录 | 1 天 |
| 2.2 | `users` 表 + migration 012 | 半天 |
| 2.3 | RLS 策略 on all tables | 1 天 |
| 2.4 | 登录 / 登出 / 密码重置 UI | 1 天 |
| 2.5 | 老板 `/dashboard` 路由（只显示自己的） | 1 天 |
| 2.6 | Admin `/admin` 路由（看所有） | 1 天 |
| 2.7 | Session 持久化 + 错误处理 | 半天 |

**里程碑：** 老板能登录看到自己的工单

### Phase 3：Vapi 自动化（1.5 周）

| # | 事项 | 时间 |
|---|---|---|
| 3.1 | `scripts/provision-customer.js`：API 买号 + 建 assistant + 绑号 | 1 天 |
| 3.2 | 修改 webhook 路由：`getBossByVapiAssistantId` 替代 `getBossByCountry` | 半天 |
| 3.3 | Tool endpoint 验证按 assistant 隔离 | 半天 |
| 3.4 | 自动录音上传 + 永久存储（已有，验证） | 半天 |
| 3.5 | 失败重试 + 死信队列 | 1 天 |
| 3.6 | 客户 onboarding 后台表单 | 1 天 |

**里程碑：** Admin 在后台填表，10 分钟后客户号码可用

### Phase 4：生产打磨（1.5 周）

| # | 事项 | 时间 |
|---|---|---|
| 4.1 | LLM 摘要 prompt 优化（多场景） | 1 天 |
| 4.2 | 工单状态机（accepted/confirmed/in_progress/completed/cancelled） | 1 天 |
| 4.3 | 老板操作 UI（确认 / 改时间 / 拒绝 / 回拨） | 1 天 |
| 4.4 | SMS / Email 推送集成（Twilio + Resend） | 1 天 |
| 4.5 | 录音播放器 + 波形图 | 半天 |
| 4.6 | 错误页面 + 加载状态 + 空状态 | 半天 |
| 4.7 | 客户支持邮箱 + WhatsApp Business 集成 | 半天 |

**里程碑：** 端到端可用

### Phase 5：H-Master go-live（1 周）

| # | 事项 | 时间 |
|---|---|---|
| 5.1 | 收齐 H-Master 真实资料（已有 checklist） | 等你 |
| 5.2 | 录 H-Master 老板语音 | 你 |
| 5.3 | 通过后台为 H-Master 创建账号 | 我 |
| 5.4 | 10 个测试剧本走通 | 一起 |
| 5.5 | 调优 prompt + 定价 | 我 |
| 5.6 | 真实电话号码开通 | 半天 |
| 5.7 | 老板培训（30 分钟远程视频） | 半天 |
| 5.8 | 上线观察 1 周 | 持续 |

**里程碑：** H-Master 老板用上 AI 接待员

### Phase 6：第 2-3 个客户（持续）

复制 H-Master 流程。每加一个客户 ~1 天。

---

## 5. 资源 & 成本估算

### 5.1 人力

| 角色 | 投入 |
|---|---|
| 全栈开发（你 + 我） | 10 周集中 |
| 销售（你） | 持续 |
| 客户成功（你） | 持续 |

### 5.2 月度运营成本（按 5 个客户估算）

| 项 | 单价 | 月用量 | 月成本 |
|---|---|---|---|
| Vapi 号码（5 个） | $1.50/月 | 5 | $7.50 |
| Vapi 通话 | $0.05/分钟 | 500 分钟 | $25 |
| OpenAI（LLM 摘要） | $0.001/通 | 500 通 | $0.50 |
| ElevenLabs（语音 clone） | $5/月/voice | 5 | $25 |
| Twilio SMS | $0.05/条 | 200 | $10 |
| Supabase | $25/月（Pro） | 1 | $25 |
| Vercel | $20/月（Pro） | 1 | $20 |
| Sentry | $0（free tier） | - | $0 |
| Domain | $15/年 | 1 | $1.25 |
| **小计** | | | **~$114/月** |

按 5 客户 / 月 500 通电话 = **每通 $0.23**。客单价至少 $30/月才能盈亏平衡。

### 5.3 一次性成本

| 项 | 成本 |
|---|---|
| 域名（首年） | $15 |
| 设计 / logo | 自有（零） |
| 法律 / Privacy Policy | 自有模板（零）或律师 $500-1000 |
| Vapi 初始 credit | $5 |

---

## 6. 定价模型（建议）

| Plan | 月费 | 通话额度 | 超出 | 目标客户 |
|---|---|---|---|---|
| Trial | 免费 14 天 | 50 通 | 停 | 评估期 |
| Starter | $99/月 | 200 通 | $0.50/通 | 1-3 人小队 |
| Pro | $299/月 | 1000 通 | $0.30/通 | 5-10 人团队 |
| Enterprise | 议价 | 议价 | - | 大型 |

参考：
- US 市场 receptionist 工资 $2700/月
- 我们 $99-299 = 工资的 4-11%
- 即使只有 1/10 客户选 Pro 也能 cover 成本

---

## 7. 风险 & 决策点

### 7.1 关键决策（需要你拍板）

| 决策 | 选项 | 我的建议 |
|---|---|---|
| 域名 | handyline.bookloh.com / handyline.ai / 其他 | handyline.ai（如可用） |
| 鉴权方案 | Supabase Auth（推荐）/ Clerk / NextAuth | Supabase Auth（最少新依赖） |
| 支付方案 | Stripe / iPay88 / 银行转账手动 | 先线下，3 客户后再上 Stripe |
| 数据存储地区 | Supabase Singapore / US | Singapore（SEA 客户） |
| 自助 vs 销售 | 销售-led / 自助 / 混合 | 销售-led（5 客户以内） |

### 7.2 风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 客户通话质量差（STT 误识别） | 中 | 高 | 多测试 + 老板旁听第一周 |
| Vapi 号码申请被拒（MY 监管） | 中 | 高 | 同时申请多个运营商备份 |
| 客户 PDPA 投诉 | 低 | 中 | 录音告知 + 30 天自动删 + 快速响应 |
| 通话成本失控 | 低 | 中 | LLM 缓存 + 通话时长限制 + 月度 cap |
| H-Master 单家 churn | 中 | 高 | 月度 review + 持续优化 prompt |

---

## 8. 第一周具体动作（这周就要做的）

| Day | 动作 |
|---|---|
| Day 1 (今天) | 确认域名 + 决定鉴权方案 + 注册 Sentry 账号 |
| Day 2 | Migration 012: `users` + `subscriptions` + `work_order_events` 表 |
| Day 3 | 鉴权基础：Supabase Auth + 登录页 + RLS 第一版 |
| Day 4 | 老板 dashboard 路由（v1，简化版） |
| Day 5 | 部署到 `handyline.bookloh.com` 域名 + Sentry 集成 + 跑通内部测试 |

**周末：** 内部用户（你自己）走一遍 H-Master onboarding 流程，模拟真实使用。

---

## 9. 10 周后的样子

| 维度 | 现在 | MVP 完成后 |
|---|---|---|
| 客户数 | 1（H-Master，等开通） | 3-5 家 |
| 鉴权 | 无 | Supabase Auth + RLS |
| 域名 | vercel.app 子域 | 自定义域名 + SSL |
| 老板登录 | 不可能 | 看自己工单 + 录音 + 操作 |
| Admin 后台 | 简单 dashboard | 客户管理 + 成本监控 + 通话统计 |
| 支付 | 无 | 线下合同 + 银行转账 |
| 监控 | Vercel 默认 | Sentry + Uptime + 自定义 alert |
| 合规 | 无 | Privacy Policy + ToS + PDPA |
| 可靠性 | 默认 | 99% uptime + 重试 + 备份验证 |
| 文档 | SETUP.md | DEPLOYMENT.md + ONBOARDING.md + API.md |

---

## 10. 开放问题（需要你定）

1. **域名用哪个？** handyline.ai / handyline.bookloh.com / 其他？
2. **鉴权方案确认：** Supabase Auth OK 吗？还是要 Clerk / 自建？
3. **数据存储地区：** Supabase Singapore 还是 US？H-Master 在 Sarawak 选 SG 区域更合规。
4. **计费方式：** 真的先线下 / 还是要上 Stripe？
5. **Trial 政策：** 给 H-Master 多长时间 trial？收不收押金？
6. **定价模型：** 上面 4 档 plan 可以接受吗？$99 starter 起步？

**这些不定下来，10 周计划没法开始。** 拍板后我开 Phase 1。
