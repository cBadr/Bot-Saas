# 🐋 Orca — دليل التشغيل الكامل

دليل شامل لتشغيل منصة Orca محلياً على Windows.

---

## 📋 المتطلبات

| المكوّن | الإصدار | كيفية التحقق |
|---------|---------|--------------|
| Node.js | ≥ 22 LTS | `node --version` |
| pnpm | ≥ 10 | `pnpm --version` |
| PostgreSQL | ≥ 17 | `psql --version` |
| Redis (Memurai) | ≥ 4 | `Get-Service Memurai` |
| PowerShell | 5.1+ | `$PSVersionTable.PSVersion` |

> **ملاحظة Windows**: استخدمنا **Memurai** كبديل Redis متوافق 100% (مجاني للتطوير).

---

## 🚀 التشغيل السريع (3 أوامر)

من جذر المشروع `c:\Users\Badr\OneDrive\Desktop\Trading`:

```powershell
# 1. ثبّت التبعيات (أول مرة فقط)
pnpm install

# 2. ابنِ كل شيء
pnpm fresh:build

# 3. شغّل كل الخدمات (يفتح 3 نوافذ PowerShell)
pnpm start:all
```

ثم افتح: **http://localhost:3000**

| | البيانات الافتراضية |
|---|---|
| **Email** | `admin@orca.local` |
| **Password** | `ChangeMe123!` |

---

## 🗂️ معمارية الخدمات

| الخدمة | المنفذ | الوظيفة |
|--------|--------|---------|
| **API** (NestJS) | `4000` | REST API لكل العمليات |
| **Engine** (Node) | `4001` | تنفيذ البوتات + Binance WebSocket |
| **Web** (Next.js) | `3000` | واجهة المستخدم |
| **PostgreSQL** | `5432` | قاعدة البيانات |
| **Redis (Memurai)** | `6379` | كاش + Pub/Sub بين API و Engine |

---

## ⚙️ الإعداد لأول مرة

### 1. تأكد من تشغيل PostgreSQL و Redis

```powershell
# PostgreSQL
Get-Service postgresql*

# Redis (Memurai)
Get-Service Memurai

# لو متوقفة:
Start-Service Memurai
Start-Service postgresql-x64-18  # عدّل الاسم حسب نسختك
```

### 2. إعداد قاعدة البيانات

```powershell
# أنشئ الـ database
$env:PGPASSWORD = "Medoza120a"
psql -U postgres -h localhost -c "CREATE DATABASE orca;"

# انسخ ملف البيئة
Copy-Item .env.example .env
# عدّل DATABASE_URL في .env بكلمة مرور postgres الخاصة بك

# نفّذ migrations + seed
pnpm -w run db:migrate
pnpm -w run db:seed
```

### 3. ثبّت + ابنِ

```powershell
pnpm install
pnpm fresh:build
```

---

## 🎯 سكريبتات سريعة

| الأمر | الوصف |
|-------|-------|
| `pnpm start:all` | يشغل API + Engine + Web في 3 نوافذ |
| `pnpm stop:all` | يوقف كل عمليات Node |
| `pnpm fresh:build` | ينظف dist + يبني كل شيء من الصفر |
| `pnpm -w run db:migrate` | تطبيق Prisma migrations |
| `pnpm -w run db:seed` | إعادة تعبئة البيانات الافتراضية (Plans, Admin) |
| `pnpm -w run db:studio` | فتح Prisma Studio (متصفح DB) |
| `pnpm test:binance` | اختبار اتصال Binance API تفاعلي |

---

## 🐛 استكشاف الأخطاء

### ❌ المشكلة: `Cannot find module 'dist/main'` أو `Missing builds`

**السبب:** لم تبنِ المشروع، أو `tsbuildinfo` يخدع TypeScript فيتجاهل البناء.

```powershell
# الحل المضمون (ينظف tsbuildinfo + dist + يبني من الصفر)
pnpm fresh:build
```

> **ملاحظة:** عُدنا الآن نستخدم `incremental: false` في `tsconfig.base.json` لتجنب هذه المشكلة نهائياً.

---

### ❌ المشكلة: `ECONNREFUSED 127.0.0.1:6379` (Redis)

**السبب:** Memurai متوقف.

```powershell
Start-Service Memurai
```

---

### ❌ المشكلة: `P1001` أو `Connection refused` (PostgreSQL)

**السبب:** PostgreSQL متوقف أو كلمة المرور خاطئة في `.env`.

```powershell
# تحقق من الخدمة
Get-Service postgresql*
Start-Service postgresql-x64-18

# تحقق من الاتصال
$env:PGPASSWORD = "كلمة-المرور-الخاصة-بك"
psql -U postgres -h localhost -c "SELECT 1;"

# عدّل في .env:
# DATABASE_URL="postgresql://postgres:كلمة-المرور@localhost:5432/orca?schema=public"
```

---

### ❌ المشكلة: `P1002 Timed out trying to acquire a postgres advisory lock`

**السبب:** عملية Node سابقة لا تزال متصلة بـ DB.

```powershell
# اقتل كل عمليات node
pnpm stop:all

# أو يدوياً
Get-Process node | Stop-Process -Force

# أعد المحاولة
pnpm -w run db:migrate
```

---

### ❌ المشكلة: 500 Internal Server Error مع `Cannot read properties of undefined`

**السبب:** عملية Node قديمة لا تزال تعمل بكود قديم.

```powershell
pnpm stop:all
pnpm fresh:build
pnpm start:all
```

---

### ❌ المشكلة: Web يعرض 404 على /dashboard

**السبب:** Web App لم يكتمل بناؤه.

```powershell
# تحقق
ls apps/web/.next

# لو مفقود:
cd apps/web
pnpm build
cd ../..
```

---

### ❌ المشكلة: `pnpm: command not found`

```powershell
# ثبّت pnpm عالمياً
npm install -g pnpm@latest
```

---

### ❌ المشكلة: `Port 3000/4000/4001 already in use`

```powershell
# اعثر على العملية واقتلها
Get-NetTCPConnection -LocalPort 3000 | Select-Object -First 1 OwningProcess | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
# عدّل المنفذ حسب الحاجة
```

---

### ❌ المشكلة: تغييرات الكود لا تظهر

**السبب:** لازم تبني من جديد بعد تعديل API/Engine.

```powershell
# للـ API/Engine: لا يوجد hot-reload في وضع start
pnpm stop:all
pnpm --filter @orca/api build       # أو @orca/engine
pnpm start:all

# للـ Web: hot-reload يعمل في dev mode
cd apps/web && pnpm dev   # بدلاً من pnpm start
```

---

## 🔧 وضع التطوير (مع Hot Reload)

في 3 نوافذ PowerShell منفصلة:

```powershell
# نافذة 1 - API
cd apps/api
pnpm dev

# نافذة 2 - Engine
cd apps/engine
pnpm dev

# نافذة 3 - Web (يدعم HMR كاملاً)
cd apps/web
pnpm dev
```

> **تنبيه**: `pnpm dev` للـ API/Engine يعيد التشغيل كاملاً عند كل تغيير (~3-5s). للسرعة القصوى استخدم `pnpm start` بعد كل build.

---

## 📊 فحص الصحة

```powershell
# API
curl http://localhost:4000/api/v1/health

# Engine
curl http://localhost:4001/health

# Web
curl -I http://localhost:3000/
```

النتائج المتوقعة:
- API: `{"ok":true,"data":{"checks":{"db":{"ok":true},"redis":{"ok":true},"binance":{"ok":true}}}}`
- Engine: `{"ok":true,"service":"orca-engine","runningBots":N}`
- Web: `200 OK`

---

## 🌐 الصفحات المتاحة

### عامة (بدون تسجيل دخول)
- `/` — الصفحة الرئيسية
- `/pricing` — الباقات
- `/login` — تسجيل دخول
- `/register` — حساب جديد

### للمستخدم
- `/dashboard` — اللوحة الرئيسية
- `/bots` — قائمة البوتات + Start/Stop/Delete
- `/bots/new` — إنشاء بوت جديد (Grid + Paper Trading)
- `/bots/:id` — تفاصيل بوت + الأحداث + الأوامر (live)
- `/exchange-keys` — مفاتيح Binance API
- `/strategies` — الاستراتيجيات
- `/strategies/builder` — Visual Builder (نوود)
- `/backtest` — اختبار استراتيجية على بيانات تاريخية
- `/reports` — تقارير P&L + رسوم بيانية
- `/billing` — الاشتراك + المدفوعات
- `/settings` — إعدادات الحساب

### للأدمن (يحتاج role = ADMIN/SUPER_ADMIN)
- `/admin` — Overview (Stats + MRR)
- `/admin/users` — إدارة المستخدمين (role + status)
- `/admin/plans` — الباقات
- `/admin/settings` — إعدادات المنصة
- `/admin/flags` — Feature Flags
- `/admin/audit` — سجل العمليات الإدارية

---

## 🔑 متغيرات البيئة المهمة (`.env`)

| المتغير | الوصف |
|---------|-------|
| `DATABASE_URL` | اتصال PostgreSQL |
| `REDIS_URL` | اتصال Redis/Memurai |
| `AUTH_SECRET` | مفتاح JWT (غيّره في الإنتاج!) |
| `BINANCE_REQUESTS_PER_MINUTE` | حد الـ rate limit (افتراضي 1100) |
| `LOG_LEVEL` | مستوى السجلات (`debug`/`info`/`warn`) |
| `LOG_PRETTY` | تنسيق ملوّن في الـ console |
| `TELEGRAM_BOT_TOKEN` | (اختياري) لإشعارات Telegram |
| `COINPAYMENTS_*` | (اختياري) للمدفوعات |
| `ADMIN_DEFAULT_EMAIL` | بريد الأدمن الافتراضي |
| `ADMIN_DEFAULT_PASSWORD` | كلمة مرور الأدمن الافتراضية |

---

## 📁 هيكل المشروع

```
orca/
├── apps/
│   ├── api/          # NestJS (REST + WebSocket)
│   ├── engine/       # Bot execution worker
│   └── web/          # Next.js 15 dashboard
├── packages/
│   ├── config/       # Env loader (Zod)
│   ├── shared/       # Types + Constants + Utils
│   ├── logger/       # Pino structured logger
│   ├── db/           # Prisma schema + client
│   ├── exchange/     # Binance connector
│   └── strategies/   # Built-in strategies (Grid)
├── scripts/
│   ├── start-all.ps1 # تشغيل كل شيء
│   ├── stop-all.ps1  # إيقاف كل شيء
│   ├── fresh-build.ps1 # بناء نظيف
│   └── test-binance.ts # اختبار Binance API
├── .env              # متغيرات البيئة
└── RUNNING.md        # هذا الملف
```

---

## 🆘 إعادة ضبط كاملة (Nuclear Option)

عند فشل كل شيء:

```powershell
# 1. أوقف كل شيء
pnpm stop:all

# 2. احذف node_modules
Remove-Item -Recurse -Force node_modules
Get-ChildItem -Recurse -Directory -Filter node_modules | Remove-Item -Recurse -Force

# 3. احذف builds
Get-ChildItem -Recurse -Directory -Include 'dist', '.next', '.turbo' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force

# 4. أعد التثبيت
pnpm install

# 5. أعد إنشاء DB من الصفر (تحذير: يحذف كل البيانات!)
$env:PGPASSWORD = "Medoza120a"
psql -U postgres -c "DROP DATABASE IF EXISTS orca;"
psql -U postgres -c "CREATE DATABASE orca;"

# 6. migrations + seed
pnpm -w run db:migrate
pnpm -w run db:seed

# 7. ابنِ + شغّل
pnpm fresh:build
pnpm start:all
```

---

## 📞 للمساعدة

عند مواجهة مشكلة جديدة:
1. شغّل `pnpm stop:all`
2. تحقق من السجلات في النوافذ المفتوحة
3. تأكد أن PostgreSQL + Memurai يعملان
4. شغّل `pnpm fresh:build` ثم `pnpm start:all`
