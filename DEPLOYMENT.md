# 🚀 Orca — دليل النشر على Windows Server

دليل كامل لرفع منصة Orca على Windows Server (VPS / Dedicated) والوصول إليها عبر domain أو IP عام.

---

## 🐛 المشكلة الشائعة (السبب الجذري)

عند فتح الموقع من خارج السيرفر تظهر الواجهة لكن:
- لا تستطيع تسجيل الدخول
- البيانات لا تُحمَّل
- Connection status أحمر / "Network Error"

**السبب:** الـ Frontend (Next.js) مبني بـ URLs ثابتة `localhost` داخل الـ JavaScript bundle. عندما تفتح الصفحة من جهاز آخر، المتصفح يحاول الاتصال بـ `localhost` على **جهازك أنت** بدلاً من السيرفر.

**ليس مشكلة قاعدة البيانات** — قاعدة البيانات ستبقى على `localhost` لأن API يعمل على نفس السيرفر. المشكلة في URLs التي يستخدمها المتصفح.

---

## 🏗️ المعمارية على السيرفر

```
                    ┌──────────────────────────┐
                    │   Internet (المستخدم)    │
                    └────────────┬─────────────┘
                                 │
                          HTTPS │ :443
                                 ↓
                    ┌──────────────────────────┐
                    │  Reverse Proxy (Nginx)   │  ← يوزّع الطلبات
                    │  yourdomain.com :80/:443 │
                    └────┬───────────┬─────────┘
                         │           │
              /api/* + ws │           │ /* (الواجهة)
                         ↓           ↓
                    ┌────────┐   ┌────────┐
                    │ API    │   │ Web    │
                    │ :4000  │   │ :3000  │
                    └────┬───┘   └────────┘
                         │
                         ↓
                ┌────────────────┐  ┌──────────┐  ┌──────────┐
                │ Engine :4001   │  │ Postgres │  │  Redis   │
                │                │  │  :5432   │  │  :6379   │
                └────────────────┘  └──────────┘  └──────────┘

كل ما هو خلف :443 يعمل localhost ↔ localhost على نفس السيرفر — آمن وسريع.
```

**الفكرة:** كل شيء يعمل `localhost` داخلياً، لكن المستخدم الخارجي يدخل عبر **منفذ واحد فقط** (443) عبر Nginx الذي يوجّه:
- `yourdomain.com/` → Web (Next.js على :3000)
- `yourdomain.com/api/*` → API (NestJS على :4000)
- `yourdomain.com/socket.io/*` → API WebSocket

---

## ✅ Checklist قبل النشر

| البند | كيفية التحقق |
|---|---|
| Node.js ≥ 22 LTS مثبّت على السيرفر | `node --version` |
| pnpm ≥ 10 | `pnpm --version` |
| PostgreSQL 17 يعمل + DB `orca` موجودة | `psql -U postgres -l` |
| Redis (Memurai) يعمل | `Get-Service Memurai` |
| Nginx مثبّت | `nginx -v` |
| Domain يشير إلى IP السيرفر | `nslookup yourdomain.com` |
| Firewall يسمح بـ 80, 443 فقط | `Get-NetFirewallRule` |
| API/Engine/Web ports (4000/4001/3000) **غير مفتوحة خارجياً** | block at firewall |

---

## ⚙️ الخطوة 1 — إعداد متغيرات البيئة الإنتاجية

أنشئ `.env` في جذر المشروع على السيرفر بهذه القيم:

```ini
NODE_ENV=production

# ───── الدومين الخاص بك (الأهم!) ─────
PUBLIC_DOMAIN=https://yourdomain.com
NEXT_PUBLIC_API_URL=https://yourdomain.com/api/v1
NEXT_PUBLIC_WS_URL=https://yourdomain.com
API_CORS_ORIGIN=https://yourdomain.com

# لو ما عندك دومين بعد، استخدم IP السيرفر مع http (مؤقتاً):
# NEXT_PUBLIC_API_URL=http://203.0.113.45/api/v1
# NEXT_PUBLIC_WS_URL=http://203.0.113.45
# API_CORS_ORIGIN=http://203.0.113.45

# ───── Database (تبقى على localhost لأنها على نفس السيرفر) ─────
DATABASE_URL="postgresql://postgres:STRONG_PASSWORD_HERE@localhost:5432/orca?schema=public"

# ───── Redis (نفس الشيء) ─────
REDIS_URL="redis://127.0.0.1:6379"

# ───── منافذ داخلية (لا تُعرَّض خارجياً) ─────
API_PORT=4000
API_HOST=127.0.0.1          # ← غيّرها من 0.0.0.0 إلى 127.0.0.1 لئلا يُكشَف API مباشرة
WEB_PORT=3000
ENGINE_PORT=4001

# ───── أسرار قوية للإنتاج (32+ حرف عشوائي) ─────
AUTH_SECRET="generate-with-openssl-rand-base64-48"
ENCRYPTION_SECRET="generate-with-openssl-rand-base64-48"

# ───── Binance ─────
BINANCE_BASE_URL=https://api.binance.com

# ───── Logs (production) ─────
LOG_PRETTY=false
LOG_LEVEL=info

# ───── إيميل/تيليجرام/Coinpayments إن لزم ─────
TELEGRAM_BOT_TOKEN=
COINPAYMENTS_PUBLIC_KEY=
COINPAYMENTS_PRIVATE_KEY=
COINPAYMENTS_IPN_SECRET=

ADMIN_DEFAULT_EMAIL=admin@yourdomain.com
ADMIN_DEFAULT_PASSWORD=GenerateAStrongOneAndChangeOnFirstLogin
```

### توليد أسرار قوية على Windows

```powershell
# يولّد سلسلة عشوائية 48 حرف
[System.Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

> ⚠️ **مهم جداً:** `NEXT_PUBLIC_*` متغيّرات تُحقَن داخل JavaScript bundle **وقت البناء** (build time). أي تعديل عليها يتطلّب **إعادة بناء كامل** للـ web. لا فائدة من تعديلها بعد الـ build.

---

## ⚙️ الخطوة 2 — البناء على السيرفر

```powershell
cd C:\path\to\Trading

# ثبّت التبعيات
pnpm install --frozen-lockfile

# طبّق الـ migrations + seed (أول مرة فقط)
pnpm --filter @orca/db prisma migrate deploy
pnpm --filter @orca/db seed

# ابنِ كل شيء بترتيب صحيح
pnpm fresh:build
```

> الـ `NEXT_PUBLIC_*` متغيّرات تُلتقط الآن من `.env` وتُدمج داخل bundle.

---

## ⚙️ الخطوة 3 — تثبيت Nginx على Windows

### تنزيل وتثبيت

1. حمّل من [nginx.org/en/download.html](https://nginx.org/en/download.html) → Stable version Windows
2. فُكّ الضغط في `C:\nginx`
3. شغّله:
   ```powershell
   cd C:\nginx
   .\nginx.exe
   ```
4. تأكد بفتح `http://localhost` → يجب أن ترى Welcome to nginx

### إعداد Reverse Proxy

عدّل `C:\nginx\conf\nginx.conf` بهذا المحتوى:

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
    include       mime.types;
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;

    # ─── Upstream backends ───
    upstream orca_api {
        server 127.0.0.1:4000;
        keepalive 32;
    }
    upstream orca_web {
        server 127.0.0.1:3000;
        keepalive 32;
    }

    # ─── HTTP → HTTPS redirect ───
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;
        return 301 https://$host$request_uri;
    }

    # ─── HTTPS main server ───
    server {
        listen 443 ssl http2;
        server_name yourdomain.com www.yourdomain.com;

        # SSL certs (راجع الخطوة 4 لكيفية الحصول عليها)
        ssl_certificate     C:/certs/yourdomain.com/fullchain.pem;
        ssl_certificate_key C:/certs/yourdomain.com/privkey.pem;
        ssl_protocols       TLSv1.2 TLSv1.3;
        ssl_ciphers         HIGH:!aNULL:!MD5;
        ssl_session_cache   shared:SSL:10m;
        ssl_session_timeout 1d;

        # حدود الطلب لرفع الملفات وما شابه
        client_max_body_size 10m;

        # ─── API routes ───
        location /api/ {
            proxy_pass http://orca_api;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 60s;
            proxy_connect_timeout 10s;
        }

        # ─── Socket.IO (real-time bot updates) ───
        location /socket.io/ {
            proxy_pass http://orca_api;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # ─── Next.js (الواجهة + كل ما تبقى) ───
        location / {
            proxy_pass http://orca_web;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            # Next.js HMR / WebSocket dev (اتركها للأمان)
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 60s;
        }

        # ─── ضغط الملفات ───
        gzip on;
        gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
        gzip_min_length 1000;
    }
}
```

ثم أعد التحميل:

```powershell
cd C:\nginx
.\nginx.exe -s reload
```

---

## 🔒 الخطوة 4 — شهادة SSL مجانية (Let's Encrypt)

استخدم **win-acme** على Windows (بديل Certbot):

```powershell
# تنزيل win-acme
Invoke-WebRequest -Uri "https://github.com/win-acme/win-acme/releases/latest/download/win-acme.v2.x.zip" -OutFile "$env:TEMP\winacme.zip"
Expand-Archive "$env:TEMP\winacme.zip" -DestinationPath "C:\win-acme"
cd C:\win-acme
.\wacs.exe
```

**اتبع المعالج:**
1. اختر `M` (Manual) ثم `1` (Single binding)
2. أدخل الدومين: `yourdomain.com,www.yourdomain.com`
3. اختر validation: `4` (Save HTTP challenge files to known location) → اعطه `C:\nginx\html`
4. Store: `2` (PEM files) → احفظها في `C:\certs\yourdomain.com`
5. Installation: `4` (No installation steps)

> win-acme سيُجدِّد الشهادة تلقائياً كل 60 يوماً عبر Scheduled Task.

بعد إصدار الشهادة، أعد تحميل nginx: `.\nginx.exe -s reload`.

---

## ⚙️ الخطوة 5 — تشغيل الخدمات كـ Windows Services

السكريبت الحالي `start-all.ps1` يفتح 3 نوافذ — هذا للتطوير. للإنتاج استخدم **NSSM** (Non-Sucking Service Manager).

### تنزيل NSSM

```powershell
Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile "$env:TEMP\nssm.zip"
Expand-Archive "$env:TEMP\nssm.zip" -DestinationPath "C:\nssm"
# أضف C:\nssm\nssm-2.24\win64 إلى PATH أو استخدمه كاملاً
```

### تسجيل 3 خدمات

شغّل كـ Administrator:

```powershell
$nssm = "C:\nssm\nssm-2.24\win64\nssm.exe"
$projectRoot = "C:\path\to\Trading"
$nodePath = (Get-Command node).Source
$pnpmPath = (Get-Command pnpm).Source

# ─── Orca API ───
& $nssm install Orca-API $nodePath "apps\api\dist\main.js"
& $nssm set Orca-API AppDirectory $projectRoot
& $nssm set Orca-API AppEnvironmentExtra "NODE_ENV=production"
& $nssm set Orca-API DisplayName "Orca API Server"
& $nssm set Orca-API Start SERVICE_AUTO_START
& $nssm set Orca-API AppStdout "$projectRoot\logs\api.log"
& $nssm set Orca-API AppStderr "$projectRoot\logs\api.err.log"
& $nssm set Orca-API AppRotateFiles 1
& $nssm set Orca-API AppRotateBytes 10485760

# ─── Orca Engine ───
& $nssm install Orca-Engine $nodePath "apps\engine\dist\main.js"
& $nssm set Orca-Engine AppDirectory $projectRoot
& $nssm set Orca-Engine AppEnvironmentExtra "NODE_ENV=production"
& $nssm set Orca-Engine DisplayName "Orca Engine Worker"
& $nssm set Orca-Engine Start SERVICE_AUTO_START
& $nssm set Orca-Engine AppStdout "$projectRoot\logs\engine.log"
& $nssm set Orca-Engine AppStderr "$projectRoot\logs\engine.err.log"

# ─── Orca Web ───
# Next.js يحتاج تشغيل عبر `next start` بعد البناء
& $nssm install Orca-Web $pnpmPath "--filter @orca/web start"
& $nssm set Orca-Web AppDirectory $projectRoot
& $nssm set Orca-Web AppEnvironmentExtra "NODE_ENV=production`0PORT=3000"
& $nssm set Orca-Web DisplayName "Orca Web Frontend"
& $nssm set Orca-Web Start SERVICE_AUTO_START

# ─── ابدأ الكل ───
Start-Service Orca-API
Start-Service Orca-Engine
Start-Service Orca-Web

# ─── تحقق ───
Get-Service Orca-* | Format-Table Name, Status
```

### إيقاف / إعادة تشغيل

```powershell
Restart-Service Orca-API, Orca-Engine, Orca-Web
Stop-Service    Orca-API, Orca-Engine, Orca-Web
Start-Service   Orca-API, Orca-Engine, Orca-Web
```

> الخدمات ستبدأ تلقائياً عند إعادة تشغيل السيرفر.

---

## 🔥 الخطوة 6 — Firewall (مهم للأمان)

```powershell
# اسمح بـ 80 و 443 (HTTP/HTTPS) من الإنترنت
New-NetFirewallRule -DisplayName "Orca HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "Orca HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow

# امنع وصول مباشر للـ API/Engine/Web من الإنترنت (تحدث من خلال Nginx فقط)
New-NetFirewallRule -DisplayName "Orca API Internal Only"    -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Block -RemoteAddress Internet
New-NetFirewallRule -DisplayName "Orca Engine Internal Only" -Direction Inbound -Protocol TCP -LocalPort 4001 -Action Block -RemoteAddress Internet
New-NetFirewallRule -DisplayName "Orca Web Internal Only"    -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Block -RemoteAddress Internet

# امنع وصول DB و Redis (يجب ألا تُكشَف أبداً)
New-NetFirewallRule -DisplayName "Postgres Localhost Only" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Block -RemoteAddress Internet
New-NetFirewallRule -DisplayName "Redis Localhost Only"    -Direction Inbound -Protocol TCP -LocalPort 6379 -Action Block -RemoteAddress Internet
```

تحقق:
```powershell
Get-NetFirewallRule -DisplayName "Orca*" | Format-Table DisplayName, Enabled, Direction, Action
```

---

## 🔄 الخطوة 7 — تحديث السكريبت (Update Workflow)

عند رفع نسخة جديدة من الكود:

```powershell
cd C:\path\to\Trading

# 1. أوقف الخدمات
Stop-Service Orca-API, Orca-Engine, Orca-Web

# 2. حدّث الكود
git pull origin main

# 3. ثبّت أي تبعيات جديدة
pnpm install --frozen-lockfile

# 4. طبّق أي migrations جديدة
pnpm --filter @orca/db prisma migrate deploy

# 5. ابنِ كل شيء
pnpm fresh:build

# 6. شغّل
Start-Service Orca-API, Orca-Engine, Orca-Web

# 7. تحقق من الـ logs
Get-Content -Path .\logs\api.log -Tail 50 -Wait
```

> **مدّة الـ downtime:** ~30-90 ثانية (وقت إيقاف الخدمات + إعادة البناء).

---

## 🩺 التشخيص — لماذا لا تعمل؟

### المشكلة: الواجهة تظهر لكن "Network Error" في الكونسول

**التحقق:**
1. افتح DevTools → Network → ابحث عن طلب فاشل
2. انظر إلى الـ URL: هل هو `localhost:4000` أم `yourdomain.com/api/...`؟

**لو رأيت `localhost`:** الـ Build لم يلتقط `NEXT_PUBLIC_API_URL` الصحيح.
```powershell
# تحقق:
cat .env | Select-String "NEXT_PUBLIC"

# لو القيمة صحيحة، أعد البناء:
Remove-Item apps\web\.next -Recurse -Force
pnpm --filter @orca/web build
Restart-Service Orca-Web
```

### المشكلة: CORS error

**التحقق:** افتح DevTools Console → ابحث عن "blocked by CORS"

**الحل:** تأكد أن `API_CORS_ORIGIN` في `.env` يطابق **بالضبط** الدومين الذي تفتح منه (بما في ذلك بروتوكول https و عدم وجود trailing slash):
```
✅ API_CORS_ORIGIN=https://yourdomain.com
❌ API_CORS_ORIGIN=https://yourdomain.com/
❌ API_CORS_ORIGIN=http://yourdomain.com  (لو تستخدم HTTPS)
```

ثم: `Restart-Service Orca-API`

### المشكلة: WebSocket لا يتصل (real-time updates معطّلة)

افتح DevTools → Network → فلتر `WS`. لو ترى connections فاشلة بـ 400/500:

تأكد من إعدادات Nginx WebSocket:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### المشكلة: 502 Bad Gateway

السيرفر الخلفي توقف:
```powershell
Get-Service Orca-* | Format-Table Name, Status
# لو واحدة Stopped:
Start-Service Orca-API   # أو الخدمة المتوقفة
Get-Content .\logs\api.err.log -Tail 100
```

### المشكلة: SSL غير صالح

```powershell
# جدّد الشهادة يدوياً
cd C:\win-acme
.\wacs.exe --renew --force
.\nginx.exe -s reload
```

---

## 💾 النسخ الاحتياطي

### يومياً — Database

أنشئ Scheduled Task يشغّل هذا السكريبت:

```powershell
# C:\path\to\Trading\scripts\backup-db.ps1
$date = Get-Date -Format "yyyy-MM-dd"
$backupDir = "C:\backups\orca"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$env:PGPASSWORD = "YOUR_DB_PASSWORD"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" `
  -U postgres -h localhost -d orca `
  -F c -b -v -f "$backupDir\orca-$date.backup"

# احتفظ بآخر 14 يوم فقط
Get-ChildItem $backupDir -Filter "orca-*.backup" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 14 |
  Remove-Item
```

سجّل المهمة:
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-File C:\path\to\Trading\scripts\backup-db.ps1"
$trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM
Register-ScheduledTask -TaskName "Orca-DB-Backup" -Action $action -Trigger $trigger -RunLevel Highest
```

### الاستعادة

```powershell
$env:PGPASSWORD = "YOUR_DB_PASSWORD"
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
  -U postgres -h localhost -d orca -c -v `
  "C:\backups\orca\orca-2026-04-27.backup"
```

---

## 📊 المراقبة (Monitoring)

### Logs مباشر

```powershell
# اتبع API logs
Get-Content C:\path\to\Trading\logs\api.log -Tail 50 -Wait

# اتبع Engine logs
Get-Content C:\path\to\Trading\logs\engine.log -Tail 50 -Wait

# Nginx access logs
Get-Content C:\nginx\logs\access.log -Tail 50 -Wait
```

### Health Check Endpoint

```powershell
# يجب أن يُرجع 200
Invoke-RestMethod https://yourdomain.com/api/v1/health
```

### استخدام الموارد

```powershell
Get-Process node | Select-Object Name, Id, CPU, @{N='RAM(MB)';E={[math]::Round($_.WorkingSet64/1MB)}}
```

---

## 🚦 Production Checklist النهائي

قبل اعتبار النشر "مكتمل":

- [ ] `.env` يحوي أسرار قوية (`AUTH_SECRET`, `ENCRYPTION_SECRET` 32+ حرف)
- [ ] `NODE_ENV=production` في `.env`
- [ ] `NEXT_PUBLIC_API_URL` و `NEXT_PUBLIC_WS_URL` بدومين الإنتاج
- [ ] `API_CORS_ORIGIN` بدومين الإنتاج بالضبط
- [ ] `API_HOST=127.0.0.1` (ليس `0.0.0.0`)
- [ ] Postgres password قوي (ليس `Medoza120a`!)
- [ ] Postgres يستمع على localhost فقط (`listen_addresses = 'localhost'` في `postgresql.conf`)
- [ ] Redis لا يقبل اتصالات خارجية (`bind 127.0.0.1` في redis.conf)
- [ ] Firewall يفتح 80/443 فقط، يحجب 4000/4001/3000/5432/6379
- [ ] SSL مفعّل + auto-renew جاهز
- [ ] 3 خدمات مسجّلة في Windows Services + auto-start
- [ ] Backup يومي للـ DB يعمل
- [ ] غيّرت كلمة سر `admin@orca.local` بعد أول تسجيل دخول
- [ ] أنشأت Binance API key بصلاحية Trade فقط (لا Withdrawal)

---

## 🆘 إعادة تعيين كاملة (لو ساءت الأمور)

```powershell
Stop-Service Orca-API, Orca-Engine, Orca-Web
cd C:\path\to\Trading

# امسح كل البيلد
Remove-Item -Recurse -Force apps\*\dist, apps\*\.next, packages\*\dist, **\*.tsbuildinfo

# امسح node_modules
Get-ChildItem -Directory -Filter node_modules -Recurse | Remove-Item -Recurse -Force

# أعد كل شيء من الصفر
pnpm install --frozen-lockfile
pnpm --filter @orca/db prisma migrate deploy
pnpm fresh:build

Start-Service Orca-API, Orca-Engine, Orca-Web
```

---

## 📞 ملخّص للحالة الحالية لديك

> **مشكلتك:** فتحت الموقع من خارج السيرفر، الواجهة ظهرت لكن API يحاول `localhost`.

**الإصلاح في 5 خطوات:**

1. **حرّر `.env` على السيرفر:**
   ```ini
   NEXT_PUBLIC_API_URL=https://yourdomain.com/api/v1
   NEXT_PUBLIC_WS_URL=https://yourdomain.com
   API_CORS_ORIGIN=https://yourdomain.com
   ```

2. **أعد بناء الـ web:**
   ```powershell
   Remove-Item apps\web\.next -Recurse -Force
   pnpm --filter @orca/web build
   ```

3. **إن لم تكن أعددت Nginx بعد** → اتبع [الخطوة 3](#️-الخطوة-3--تثبيت-nginx-على-windows).

4. **أعد تشغيل الخدمات:**
   ```powershell
   Restart-Service Orca-API, Orca-Web
   ```

5. **اختبر:** افتح `https://yourdomain.com` من جهاز آخر → DevTools → Network → تأكد أن الطلبات تذهب لدومينك (ليس localhost).

---

**END OF DEPLOYMENT GUIDE**

> هذا الدليل خاص بـ Windows Server. لو نقلت لاحقاً إلى Linux، استبدل NSSM بـ PM2 / systemd، و win-acme بـ certbot.
