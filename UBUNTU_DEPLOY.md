# 🐧 Orca — Ubuntu Server Deployment Guide

دليل تركيب وتشغيل منصة Orca على سيرفر Ubuntu (22.04 LTS أو أحدث) باستخدام **PM2** لإدارة الخدمات مع الإقلاع التلقائي بعد إعادة التشغيل.

---

## 📋 المتطلبات

| المكوّن | الإصدار الموصى به |
|--------|------------------|
| Ubuntu | 22.04 LTS أو 24.04 LTS |
| Node.js | 22.x (LTS) |
| pnpm | 10.x |
| PostgreSQL | 17 |
| Redis | 7.x |
| Nginx | 1.24+ (للـ reverse proxy + SSL) |
| Certbot | الأحدث (للـ HTTPS) |
| PM2 | 5.x (process manager) |

**موارد السيرفر الموصى بها:**
- CPU: 2 cores+
- RAM: 4 GB+
- Disk: 40 GB+ SSD
- Bandwidth: 1 TB/شهر

---

## 1. تجهيز السيرفر (one-time)

### 1.1 تحديث النظام وإنشاء مستخدم خاص

```bash
# اتصل كـ root أولاً
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ufw fail2ban

# أنشئ مستخدم تطبيق (لا يكون root)
sudo adduser orca
sudo usermod -aG sudo orca
su - orca
```

### 1.2 الجدار الناري

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

### 1.3 تركيب Node.js 22

```bash
# باستخدام NodeSource (أسلم من APT الافتراضي)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# تحقق
node --version   # v22.x.x
npm --version
```

### 1.4 تركيب pnpm + PM2

```bash
sudo npm install -g pnpm@10 pm2@latest

pnpm --version   # 10.x.x
pm2 --version    # 5.x
```

### 1.5 تركيب PostgreSQL 17

```bash
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
sudo apt update
sudo apt install -y postgresql-17 postgresql-contrib-17

# تأكد من التشغيل + auto-start
sudo systemctl enable --now postgresql
sudo systemctl status postgresql
```

### 1.6 تركيب Redis

```bash
sudo apt install -y redis-server

# تعديل بسيط: تأكد أن supervised systemd
sudo sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# اختبر
redis-cli ping   # → PONG
```

### 1.7 إعداد قاعدة البيانات

```bash
sudo -u postgres psql <<EOF
CREATE USER orca WITH PASSWORD 'change_this_strong_password';
CREATE DATABASE orca OWNER orca;
GRANT ALL PRIVILEGES ON DATABASE orca TO orca;
ALTER USER orca CREATEDB;  # مطلوب لـ prisma shadow DB أثناء التطوير فقط
EOF

# اختبر الاتصال
PGPASSWORD='change_this_strong_password' psql -U orca -h localhost -d orca -c "SELECT 1;"
```

---

## 2. تنزيل ونصب المشروع

### 2.1 استنساخ المشروع

```bash
cd ~
git clone <repo-url> orca
cd orca
```

> لو ستضع المشروع في `/opt/orca` (تنظيم أفضل لـ multi-user)، استبدل `~` بـ `/opt/orca` بعد `sudo chown -R orca:orca /opt/orca`.

### 2.2 إعداد المتغيرات البيئية

```bash
cp .env.example .env
nano .env
```

**الحقول الحرجة التي يجب تعديلها:**

```dotenv
NODE_ENV=production

# DB
DATABASE_URL="postgresql://orca:change_this_strong_password@localhost:5432/orca?schema=public"

# Auth — استخدم 64+ حرف عشوائي
AUTH_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
AUTH_URL=https://yourdomain.com
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Public URLs (مستخدمة وقت البناء)
NEXT_PUBLIC_API_URL=https://yourdomain.com/api/v1
NEXT_PUBLIC_WS_URL=wss://yourdomain.com

# CORS
API_CORS_ORIGIN=https://yourdomain.com

# Logging
LOG_LEVEL=info
LOG_PRETTY=false
LOG_FILE_ENABLED=true

# Encryption (للـ Binance API keys في DB)
ENCRYPTION_SECRET="$(openssl rand -base64 32 | tr -d '\n')"

# Telegram / CoinPayments / Sentry → ضع قيمك الإنتاجية
```

> 💡 **توليد سرّ آمن:** `openssl rand -base64 64`

### 2.3 تثبيت الـ dependencies + Build

```bash
pnpm install --frozen-lockfile

# توليد Prisma client + تطبيق الـ migrations
pnpm --filter @orca/db generate
DATABASE_URL="$(grep -E '^DATABASE_URL' .env | cut -d '=' -f2- | tr -d '"')" \
  pnpm --filter @orca/db exec prisma migrate deploy

# (اختياري) شغّل الـ seed لإنشاء plans افتراضية و admin user
DATABASE_URL="..." pnpm --filter @orca/db exec tsx prisma/seed.ts

# بناء كل الحزم والتطبيقات
pnpm build
```

### 2.4 إعداد مجلد السجلات

```bash
mkdir -p logs
chmod 755 logs
```

---

## 3. تشغيل الخدمات بـ PM2

المشروع يحتوي على ملف `ecosystem.config.cjs` جاهز يدير 3 خدمات: **orca-api** (المنفذ 4000) و **orca-engine** و **orca-web** (المنفذ 3000).

### 3.1 الإقلاع الأول

```bash
cd ~/orca

# شغّل كل الخدمات
pm2 start ecosystem.config.cjs

# عرض الحالة
pm2 status
pm2 logs              # كل السجلات
pm2 logs orca-api     # سجل خدمة واحدة
```

**ستظهر 3 خدمات:**
```
┌────┬──────────────┬─────────┬──────┬────────┬──────────┐
│ id │ name         │ status  │ cpu  │ memory │ uptime   │
├────┼──────────────┼─────────┼──────┼────────┼──────────┤
│ 0  │ orca-api     │ online  │ 0.5% │ 180 MB │ 30s      │
│ 1  │ orca-engine  │ online  │ 0.3% │ 240 MB │ 30s      │
│ 2  │ orca-web     │ online  │ 0.2% │ 220 MB │ 30s      │
└────┴──────────────┴─────────┴──────┴────────┴──────────┘
```

### 3.2 ⭐ تفعيل الإقلاع التلقائي بعد إعادة التشغيل

**خطوتان فقط:**

```bash
# 1. اطلب من PM2 توليد سكربت systemd
pm2 startup systemd

# سيطبع أمراً مثل:
#   sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd \
#     -u orca --hp /home/orca
# نسخه وشغّله بنفسك (نسخ والصق):
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u orca --hp /home/orca

# 2. احفظ القائمة الحالية كي يستعيدها PM2 بعد reboot
pm2 save
```

**تحقق من النجاح:**

```bash
sudo systemctl status pm2-orca   # يجب أن يكون active (running)
sudo reboot                       # اختبار حقيقي
# بعد إعادة الاتصال:
pm2 status                        # الخدمات الثلاث يجب أن تكون online
```

---

## 4. Nginx Reverse Proxy + HTTPS

### 4.1 تركيب Nginx + Certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4.2 إعداد ملف الموقع

```bash
sudo nano /etc/nginx/sites-available/orca
```

ضع المحتوى التالي (استبدل `yourdomain.com`):

```nginx
# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$host$request_uri;
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL config (سيتم ملؤها لاحقاً بواسطة certbot)
    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    # security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    client_max_body_size 10M;

    # ─── API على /api/v1 (NestJS على المنفذ 4000) ───
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # ─── WebSocket (socket.io على نفس المنفذ 4000) ───
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;     # WS connections may idle
    }

    # ─── Next.js Web على المنفذ 3000 ───
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 4.3 فعّل الموقع واحصل على شهادة SSL

```bash
sudo ln -s /etc/nginx/sites-available/orca /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t            # اختبار الـ syntax
sudo systemctl reload nginx

# احصل على شهادة Let's Encrypt
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Certbot ينشئ cron renewal تلقائياً. تحقق:
sudo systemctl status certbot.timer
```

---

## 5. أوامر إدارة PM2 (مرجع سريع)

| الأمر | الوظيفة |
|------|--------|
| `pm2 status` | عرض حالة كل الخدمات |
| `pm2 logs` | سجلات live لكل الخدمات |
| `pm2 logs orca-api --lines 200` | آخر 200 سطر من خدمة محددة |
| `pm2 restart orca-api` | إعادة تشغيل خدمة |
| `pm2 restart all` | إعادة تشغيل كل شيء |
| `pm2 stop orca-engine` | إيقاف خدمة |
| `pm2 start orca-engine` | تشغيل خدمة موقوفة |
| `pm2 reload all` | zero-downtime reload (cluster mode فقط) |
| `pm2 delete orca-web` | حذف خدمة من القائمة |
| `pm2 monit` | TUI مراقبة CPU/RAM لحظياً |
| `pm2 save` | احفظ القائمة الحالية للإقلاع التلقائي |
| `pm2 startup systemd` | توليد سكربت الإقلاع التلقائي |
| `pm2 unstartup systemd` | إلغاء الإقلاع التلقائي |
| `pm2 flush` | مسح كل ملفات السجل |

---

## 6. التحديثات (Deploy جديد)

عند نشر إصدار جديد من الكود:

```bash
cd ~/orca

# 1. اسحب أحدث كود
git pull origin main

# 2. ثبّت dependencies جديدة (إن وُجدت)
pnpm install --frozen-lockfile

# 3. طبّق migrations جديدة (آمن — يطبق فقط الجديد)
DATABASE_URL="..." pnpm --filter @orca/db exec prisma migrate deploy
pnpm --filter @orca/db generate

# 4. أعد البناء
pnpm build

# 5. أعد تشغيل الخدمات
pm2 restart all

# 6. تحقق من السجلات
pm2 logs --lines 50
```

> 💡 **Zero-downtime تحديثات:** بنية الـ web تُبنى داخل `.next/` ولا تتأثر مباشرة بـ pm2 restart. لو احتجت رولن أوت بدون انقطاع، استخدم `pm2 reload orca-web` بدلاً من restart.

### 6.1 سكربت تحديث جاهز

أنشئ ملفاً اسمه `deploy.sh` في جذر المشروع:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "→ Pulling latest..."
git pull origin main

echo "→ Installing deps..."
pnpm install --frozen-lockfile

echo "→ Running migrations..."
export $(grep -v '^#' .env | xargs -d '\n' -I {} echo {} | head -50)
pnpm --filter @orca/db exec prisma migrate deploy
pnpm --filter @orca/db generate

echo "→ Building..."
pnpm build

echo "→ Reloading services..."
pm2 restart all

echo "✓ Deploy complete. Checking status..."
sleep 3
pm2 status
```

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 7. النسخ الاحتياطي

### 7.1 نسخ احتياطي تلقائي لقاعدة البيانات

أنشئ `~/orca/scripts/backup-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="$HOME/orca/backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date -u +"%Y-%m-%d_%H-%M-%S")
FILE="$BACKUP_DIR/orca_$TIMESTAMP.sql.gz"

export $(grep -E '^DATABASE_URL' "$HOME/orca/.env" | cut -d= -f2-)
PGPASSWORD=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|') \
pg_dump --no-owner --no-privileges \
  -U orca -h localhost -d orca | gzip > "$FILE"

# احذف نسخاً أقدم من 14 يوم
find "$BACKUP_DIR" -name "orca_*.sql.gz" -mtime +14 -delete

echo "Backup saved: $FILE"
```

```bash
chmod +x ~/orca/scripts/backup-db.sh

# جدوله كل يوم الساعة 3 صباحاً
crontab -e
# أضف السطر:
0 3 * * * /home/orca/orca/scripts/backup-db.sh >> /home/orca/orca/logs/backup.log 2>&1
```

### 7.2 (اختياري) رفع النسخ إلى S3/B2

أضف بعد `gzip` في السكربت:

```bash
aws s3 cp "$FILE" s3://my-orca-backups/$(basename "$FILE")
# أو rclone
rclone copy "$FILE" backblaze:orca-backups/
```

---

## 8. المراقبة والتشخيص

### 8.1 السجلات

```bash
# سجلات الخدمات (PM2)
pm2 logs --lines 200          # كل الخدمات
pm2 logs orca-engine --err    # فقط الأخطاء
tail -f ~/orca/logs/api-error.log

# سجلات Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# سجلات systemd لـ PM2 نفسه
sudo journalctl -u pm2-orca -f
```

### 8.2 صحة الخدمات

```bash
# Health endpoint للـ API
curl -s https://yourdomain.com/api/v1/health | jq

# مراقبة Redis
redis-cli info | grep -E "used_memory_human|connected_clients|uptime_in_days"

# مراقبة PostgreSQL
sudo -u postgres psql orca -c "SELECT count(*) FROM \"Bot\" WHERE status='RUNNING';"

# استخدام الموارد
pm2 monit
htop
df -h
```

### 8.3 لوحة الإدارة

ادخل من المتصفح إلى `https://yourdomain.com/admin`:
- **Overview**: alerts + نبض الخدمات (DB / Redis / Engine).
- **System**: latency للـ DB، صحة Binance API، أخطاء آخر ساعة.
- **Security**: فعّل `Require 2FA` و IP allowlist للأدمن.

---

## 9. الإيقاف الطارئ

```bash
# إيقاف كل البوتات فوراً (Kill switch من الـ UI أو CLI)
pm2 stop orca-engine    # يوقف كل البوتات النشطة

# إيقاف الموقع مع الإبقاء على الـ API
pm2 stop orca-web

# إيقاف كل شيء
pm2 stop all
```

> ⚠️ **مهم:** إيقاف الـ engine لا يلغي الأوامر المفتوحة على Binance. لتصفية كاملة، ادخل لكل bot واضغط Stop من الـ UI أولاً (يلغي الأوامر بشكل صحيح).

---

## 10. حل المشاكل الشائعة

### مشكلة: PM2 لا يبدأ بعد إعادة التشغيل

```bash
sudo systemctl status pm2-orca
# لو غير موجود:
pm2 startup systemd
# انفّذ الأمر الذي يطبعه
pm2 save
```

### مشكلة: الـ API يعيد 502 من Nginx

```bash
# تأكد أن الـ API يستمع على 4000
curl http://127.0.0.1:4000/api/v1/health
pm2 logs orca-api --lines 100
# لو فيه error: راجع .env (خاصة DATABASE_URL)
```

### مشكلة: WebSocket لا يتصل

تأكد أن مقطع `/socket.io/` موجود في Nginx config (الـ `Upgrade` headers مطلوبة).

### مشكلة: الـ web يعرض القيمة الخاطئة للـ API URL

`NEXT_PUBLIC_*` تُحقن **وقت البناء** فقط. لو غيرتها بعد build، يجب إعادة `pnpm build` ثم `pm2 restart orca-web`.

### مشكلة: ذاكرة عالية / تسريب

```bash
pm2 restart orca-engine   # إعادة تشغيل خفيف يُحرر الذاكرة
# إن استمر، استشر pm2 logs و pm2 monit
# ecosystem.config.cjs مضبوط على max_memory_restart للحماية
```

### مشكلة: prisma migrate يفشل

```bash
# تأكد أن الـ env محملة
export $(grep -v '^#' ~/orca/.env | xargs)
cd ~/orca/packages/db
pnpm exec prisma migrate status   # يعرض حالة كل migration
pnpm exec prisma migrate deploy   # يطبق الجديد فقط
```

---

## 11. قائمة فحص ما قبل الإنتاج (Production checklist)

- [ ] غيّرت كل الأسرار في `.env` (AUTH_SECRET, ENCRYPTION_SECRET, DB password).
- [ ] `NODE_ENV=production` في الـ env.
- [ ] `LOG_PRETTY=false` و `LOG_LEVEL=info` (وليس debug).
- [ ] SSL مفعّل (Certbot) ويتجدد تلقائياً.
- [ ] UFW يحجب كل المنافذ ما عدا 22/80/443.
- [ ] PostgreSQL يستمع فقط على localhost (`listen_addresses = 'localhost'` في `postgresql.conf`).
- [ ] Redis يستمع فقط على localhost (`bind 127.0.0.1` في `redis.conf`).
- [ ] PM2 startup systemd مفعّل و `pm2 save` تم تشغيله.
- [ ] cron backup يومي مضبوط.
- [ ] في `/admin/security`: فعّلت `Require 2FA for admin access` بعد ربط 2FA على حسابك.
- [ ] حساب الـ admin له password قوي + 2FA enabled.
- [ ] Sentry DSN معدّ (لتتبع الأخطاء الإنتاجية).
- [ ] Telegram bot معدّ لاستلام تنبيهات النظام.

---

## 12. مرجع المعمارية

| الخدمة | المنفذ | الوظيفة |
|--------|--------|---------|
| `orca-api` | 4000 | NestJS API + WebSocket gateway |
| `orca-engine` | 4001 (internal) | Bot execution + Binance integration |
| `orca-web` | 3000 | Next.js dashboard |
| Nginx | 80/443 | Reverse proxy + SSL termination |
| PostgreSQL | 5432 (localhost) | قاعدة البيانات الأساسية |
| Redis | 6379 (localhost) | كاش + Pub/Sub بين API و Engine |

**خرائط التدفق:**
```
Browser → Nginx (443) → orca-web (3000)        ← Next.js SSR
       → Nginx (443) → orca-api (4000)         ← REST endpoints
       → Nginx (443) → /socket.io/ → orca-api  ← realtime events
                       
orca-api ↔ Redis  ← engine commands (start/stop/cancel)
orca-engine ↔ Redis  ← engine events (fills, errors)
orca-engine ↔ Binance API + WebSocket
```

---

## 13. سكربتات مفيدة (one-liners)

```bash
# عدد البوتات النشطة
sudo -u postgres psql orca -c "SELECT count(*) FROM \"Bot\" WHERE status='RUNNING';"

# آخر 10 أخطاء من الـ engine
pm2 logs orca-engine --err --lines 30

# حجم قاعدة البيانات
sudo -u postgres psql -d orca -c "SELECT pg_size_pretty(pg_database_size('orca'));"

# إعادة تحميل Nginx config بدون انقطاع
sudo nginx -t && sudo systemctl reload nginx

# تجديد شهادة SSL يدوياً (للاختبار)
sudo certbot renew --dry-run

# إعادة بناء + تحديث + إعادة تشغيل
~/orca/deploy.sh

# مراقبة CPU/RAM لحظياً
pm2 monit
```

---

## النهاية

بعد إكمال هذه الخطوات:
- المنصة تعمل على `https://yourdomain.com`.
- 3 خدمات منفصلة (api/engine/web) مُدارة بـ PM2 مع إعادة تشغيل تلقائي عند الـ crash.
- إقلاع تلقائي بعد إعادة تشغيل السيرفر (`pm2 startup` + `pm2 save`).
- HTTPS تلقائي مع تجديد تلقائي للشهادة.
- نسخ احتياطي يومي لقاعدة البيانات.
- مراقبة سهلة عبر `pm2 status` و `/admin`.

للتحديثات اليومية، يكفي تشغيل `./deploy.sh` (أو الخطوات يدوياً من القسم 6).
