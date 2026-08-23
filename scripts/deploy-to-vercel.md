# Vercel 部署指南

## 最快方法（5 分钟）

### 第 1 步：注册 / 登录 Vercel

打开 https://vercel.com/signup，用 **GitHub 账号** 登录（推荐）

### 第 2 步：建项目

打开 https://vercel.com/new

**方法 A（推荐）：拖拽部署**
- 把打包好的 Next.js 项目 zip 直接拖到 "Import Project" 页面
- Vercel 会自动识别为 Next.js 项目

**方法 B：用 Git**
- 推到 GitHub 仓库
- Vercel 选 "Import Git Repository"

### 第 3 步：项目设置

- **Project Name**: `bookloh-demo` 或 `handyline-demo`（Vercel 上唯一即可）
- **Framework Preset**: Next.js（自动检测）
- **Root Directory**: `./`
- **Build Command**: `next build`（默认）
- **Output Directory**: `.next`（默认）
- **Install Command**: `npm install`（默认）

### 第 4 步：环境变量（最关键）

点 "Environment Variables"，**一个一个加**（Vercel 不会从 .env 读）：

#### Supabase
```
NEXT_PUBLIC_SUPABASE_URL = https://cggqxaxunqxsgurgmiqh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = (从 .env.local 复制)
SUPABASE_SERVICE_ROLE_KEY = (从 .env.local 复制 — secret)
```

#### Vapi
```
VAPI_API_KEY = (从 .env.local 复制 — secret)
VAPI_ASSISTANT_ID = 42523b3e-fbaf-436a-a26a-2a6853a12ad7
NEXT_PUBLIC_VAPI_ASSISTANT_ID = 42523b3e-fbaf-436a-a26a-2a6853a12ad7
NEXT_PUBLIC_VAPI_PUBLIC_KEY = (从 .env.local 复制)
VAPI_EMERGENCY_ASSISTANT_ID = 7e2507a3-f349-4128-b117-5d3f35dae0cb
VAPI_PHONE_NUMBER_ID = b73a9ba1-fca1-4eed-b58d-82652e57a2a4
```

#### Twilio
```
TWILIO_ACCOUNT_SID = (从 .env.local 复制 — secret)
TWILIO_AUTH_TOKEN = (从 .env.local 复制 — secret)
TWILIO_PHONE_NUMBER = +17243620422
TWILIO_BOSS_PHONE = +15127126713
```

#### App config
```
WEBHOOK_SECRET = dev-secret
NEXT_PUBLIC_APP_URL = https://你的实际-vercel-域名.vercel.app (Vercel 给你的实际域名)
EMERGENCY_RETRY_INTERVAL_MINUTES = 5
EMERGENCY_MAX_ATTEMPTS = 3
EMERGENCY_TEST_MODE = 1  ← **重要：先设 1，避免生产第一单真打电话到老板**
```

#### 可选
```
GOOGLE_MAPS_API_KEY = (如果有 — secret)
```

### 第 5 步：点 Deploy

- 等待 1-3 分钟 build
- 部署成功会拿到 URL：`https://你的项目名-xxxx.vercel.app`

### 第 6 步：把 Vapi 切到 Vercel URL

部署完拿到 URL 后告诉我，我帮你：
1. 把 Vapi `serverUrl` 切到 `https://你的域名.vercel.app/api/vapi/tools`
2. 改 `.env.local` 里的 `NEXT_PUBLIC_APP_URL`（本地 dev 还是要用 Cloudflare）
3. 停掉 cloudflared LaunchAgent

---

## 自动复制环境变量的小技巧

如果你之前在 Vercel 部署过别的项目，可以用 vercel CLI 复制：

```bash
npx vercel login   # 浏览器登录
npx vercel link    # 关联项目
npx vercel env pull .env.production  # 下载远程 env 到本地
```

或者一次性添加所有 env：

```bash
npx vercel env add NEXT_PUBLIC_SUPABASE_URL
# 然后粘贴值，敲回车
```

---

## 部署后第一次跑

1. 打开 `https://你的域名.vercel.app/` — 应该看到 dashboard
2. 测试场景用 dev mode（EMERGENCY_TEST_MODE=1）— 紧急场景不会真打电话
3. 全部 OK 后，可以设 `EMERGENCY_TEST_MODE=0` 启用真实外呼
4. 真实给 +17243620422 打一次电话做端到端验证
