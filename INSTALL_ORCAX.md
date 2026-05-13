# 🚀 تركيب Orca على سيرفر Ubuntu — orcax.click

> **الهدف:** دليل تشغيلي حي للتركيب على السيرفر مع توثيق كل خطوة + أخطاء وحلول. اتبع الخطوات بالترتيب. لا تتجاوز خطوة دون التحقق منها.

---

## 📌 معلومات السيرفر

| الحقل | القيمة |
|------|-------|
| الـ IP | `77.223.215.36` |
| الـ Domain | `orcax.click` (+ `www.orcax.click`) |
| نظام التشغيل | Ubuntu (24.04 / 25.04 / 26.x) |
| المنفذ SSH | `22` |
| اسم مستخدم التطبيق | `orca` (سننشئه) |
| مسار المشروع | `/home/orca/orca` |

> **⚠️ أمان: قبل أي شيء — غيّر كلمة root**
> ```bash
> ssh root@77.223.215.36
> passwd
> ```

> **⚠️ إعداد DNS مسبقاً:** تأكد أن `orcax.click` و `www.orcax.click` يشيران إلى `77.223.215.36` (سجل A) قبل خطوة Nginx + SSL.

---

## 🟦 الجزء الأول — تجهيز السيرفر

### الخطوة 1 — الاتصال والتحقق من النظام

```bash
ssh root@77.223.215.36
lsb_release -a
uname -a
df -h
free -h
```

**المتوقع:** Ubuntu 22.04+ ، RAM ≥ 2GB، Disk ≥ 20GB free.

**إن فشل:**
- `Permission denied` → كلمة root خاطئة أو SSH معطّل لـ root.
- `Connection refused` → SSHd لا يعمل (نادر).

📝 **سجّل هنا** الـ output الفعلي:
```
[paste output here]
```

---

### الخطوة 2 — تحديث النظام والأدوات الأساسية

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential ufw fail2ban htop nano openssl ca-certificates gnupg lsb-release
```

**المتوقع:** Done بدون errors.

**إن فشل:**
- `E: Could not get lock` → عملية apt أخرى تعمل. انتظر دقيقة وأعد، أو `pkill -9 apt apt-get`.
- `Hash sum mismatch` → `apt clean && apt update`.

---

### الخطوة 3 — إعداد الجدار الناري (UFW)

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status
```

**المتوقع:**
```
Status: active
22/tcp  ALLOW Anywhere
80/tcp  ALLOW Anywhere
443/tcp ALLOW Anywhere
```

> ⚠️ **مهم:** لا تفعّل UFW قبل allow OpenSSH أو ستخرج من السيرفر.

---

### الخطوة 4 — إنشاء مستخدم التطبيق

```bash
adduser orca
# سيطلب: كلمة مرور، اسم، وغيرها (اضغط Enter للخيارات الافتراضية)

usermod -aG sudo orca
```

**اختبر:**
```bash
su - orca
whoami      # → orca
sudo -v     # يطلب كلمة المرور — إن نجح فهو في sudo group
exit        # عُد إلى root
```

📝 **احفظ كلمة مرور orca في مكان آمن.**

---

### الخطوة 5 — تركيب Node.js 22 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node --version    # → v22.x.x
npm --version
```

**إن فشل:**
- `404` من nodesource → الإصدار غير متاح لـ Ubuntu الجديد. جرّب: `curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -`
- `command not found: node` بعد التركيب → `which node` وأضف `/usr/bin` إلى PATH.

📝 **سجّل إصدار Node:**
```
node version: ___________
```

---

### الخطوة 6 — تركيب pnpm + PM2

```bash
npm install -g pnpm@10 pm2@latest

pnpm --version    # 10.x
pm2 --version     # 5.x
```

**إن فشل:**
- `EACCES permission denied` → `sudo npm install -g ...`
- pnpm version أقل من 10 → `npm uninstall -g pnpm && npm install -g pnpm@latest`.

---

### الخطوة 7 — تركيب PostgreSQL 17

```bash
sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg

# Fix the apt source to use the gpg key
sed -i 's|deb |deb [signed-by=/usr/share/keyrings/postgresql.gpg] |' /etc/apt/sources.list.d/pgdg.list

apt update
apt install -y postgresql-17 postgresql-contrib-17

systemctl enable --now postgresql
systemctl status postgresql
```

**المتوقع:** `Active: active (running)`.

**إن فشل:**
- `Package postgresql-17 has no installation candidate` → الإصدار غير متاح. جرّب `postgresql-16`.
- `Failed to enable unit: Unit ... does not exist` → التركيب لم يكتمل. `apt install -y postgresql` (الإصدار الافتراضي).

📝 **سجّل إصدار Postgres:**
```bash
sudo -u postgres psql -c "SELECT version();"
```

---

### الخطوة 8 — إنشاء قاعدة البيانات + المستخدم

**ولّد كلمة مرور قوية لـ DB:**
```bash
DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
echo "DB password: $DB_PASS"
# 📌 احفظها — ستحتاجها في .env
```

**أنشئ DB و user:**
```bash
sudo -u postgres psql <<EOF
CREATE USER orca WITH PASSWORD '$DB_PASS' CREATEDB;
CREATE DATABASE orca OWNER orca;
GRANT ALL PRIVILEGES ON DATABASE orca TO orca;
EOF
```

**اختبر الاتصال:**
```bash
PGPASSWORD="$DB_PASS" psql -U orca -h localhost -d orca -c "SELECT 1 AS ok;"
```

**المتوقع:**
```
 ok
----
  1
```

**إن فشل:**
- `peer authentication failed` → `pg_hba.conf` يحتاج تعديل. عدّل `/etc/postgresql/17/main/pg_hba.conf` وغيّر `peer` → `md5` للسطر local، ثم `systemctl reload postgresql`.

📝 **احفظ كلمة مرور DB في ملف مؤقت:**
```bash
echo "DB_PASS=$DB_PASS" >> ~/orca-install-secrets.txt
chmod 600 ~/orca-install-secrets.txt
```

---

### الخطوة 9 — تركيب Redis

```bash
apt install -y redis-server

# تأكد أن supervised systemd
sed -i 's/^supervised .*/supervised systemd/' /etc/redis/redis.conf

# تأكد أن يستمع على localhost فقط
sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf

systemctl restart redis-server
systemctl enable redis-server

redis-cli ping     # → PONG
```

**إن فشل:**
- `Could not connect to Redis` → `systemctl status redis-server` لمعرفة السبب.
- لو الـ bind غيّر الـ syntax: `grep '^bind' /etc/redis/redis.conf` وتأكد.

---

## 🟦 الجزء الثاني — تنزيل وإعداد المشروع

### الخطوة 10 — استنساخ المشروع (كمستخدم orca)

```bash
su - orca
cd ~
git clone <YOUR-REPO-URL> orca
cd orca
ls -la
```

> 💡 لو المشروع private، استخدم HTTPS مع PAT أو ضع SSH key على السيرفر:
> ```bash
> ssh-keygen -t ed25519 -C "orca-server"
> cat ~/.ssh/id_ed25519.pub   # أضف هذا إلى GitHub Deploy Keys
> ```

**إن لم يكن لديك repo:**
ارفع المشروع يدوياً عبر `rsync`/`scp` من جهازك:
```bash
# من جهازك (Windows PowerShell):
scp -r "C:\Users\Badr\OneDrive\Desktop\Trading" orca@77.223.215.36:/home/orca/orca
```

---

### الخطوة 11 — إعداد `.env` للإنتاج

```bash
cd ~/orca
cp .env.example .env

# ولّد أسرار قوية
AUTH_SECRET=$(openssl rand -base64 64 | tr -d '\n')
ENC_SECRET=$(openssl rand -base64 32 | tr -d '\n')

echo ""
echo "AUTH_SECRET=$AUTH_SECRET"
echo "ENC_SECRET=$ENC_SECRET"
echo "DB_PASS (من خطوة 8)=$(grep DB_PASS ~/orca-install-secrets.txt 2>/dev/null | cut -d= -f2)"
```

**عدّل `.env` (انسخ هذا في nano):**

```bash
nano .env
```

**استبدل المحتوى بالقيم الإنتاجية التالية** (ضع أسرارك مكان `...`):

```dotenv
NODE_ENV=production

# Database
DATABASE_URL="postgresql://orca:DB_PASS_HERE@localhost:5432/orca?schema=public"

# Redis
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_URL="redis://127.0.0.1:6379"

# API
API_PORT=4000
API_HOST=0.0.0.0
API_PREFIX=api/v1
API_CORS_ORIGIN=https://orcax.click

# Web
WEB_PORT=3000
NEXT_PUBLIC_API_URL=https://orcax.click/api/v1
NEXT_PUBLIC_WS_URL=wss://orcax.click

# Engine
ENGINE_PORT=4001
ENGINE_MAX_BOTS_PER_WORKER=10

# Auth (طوّل، عشوائي)
AUTH_SECRET="<AUTH_SECRET_HERE>"
AUTH_URL=https://orcax.click
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# Encryption (Binance API keys at rest)
ENCRYPTION_SECRET="<ENC_SECRET_HERE>"

# Binance
BINANCE_BASE_URL=https://api.binance.com
BINANCE_WS_URL=wss://stream.binance.com:9443
BINANCE_TIME_SYNC_INTERVAL_MS=60000
BINANCE_DEFAULT_RECV_WINDOW=5000
BINANCE_REQUESTS_PER_MINUTE=1100
BINANCE_ORDERS_PER_DAY=160000

# Logging
LOG_LEVEL=info
LOG_PRETTY=false
LOG_FILE_ENABLED=true
LOG_FILE_PATH=./logs

# Optional integrations (ضع قيمك أو اتركها فارغة)
SENTRY_DSN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_DEFAULT_CHAT_ID=
COINPAYMENTS_PUBLIC_KEY=
COINPAYMENTS_PRIVATE_KEY=
COINPAYMENTS_IPN_URL=https://orcax.click/api/v1/payments/coinpayments/ipn
```

**اختبر تحميل الـ env:**
```bash
set -a; source .env; set +a
echo "DATABASE_URL set: ${DATABASE_URL:0:30}..."
echo "AUTH_SECRET length: ${#AUTH_SECRET}"
```

`AUTH_SECRET length` يجب أن يكون ≥ 64.

---

### الخطوة 12 — تثبيت الـ Dependencies

```bash
cd ~/orca
pnpm install --frozen-lockfile
```

**المتوقع:** ~3-5 دقائق، آلاف الحزم.

**إن فشل:**
- `ERR_PNPM_NO_LOCKFILE` → `pnpm install` بدون `--frozen-lockfile`.
- `ENOSPC: no space left` → `df -h` للتحقق من المساحة.
- `node-gyp` errors → تأكد من `build-essential` (الخطوة 2).
- `network timeout` → جرّب `pnpm install --network-timeout 100000`.

---

### الخطوة 13 — تطبيق Database Migrations

```bash
cd ~/orca
export $(grep -v '^#' .env | xargs -d '\n' -I {} echo {} | head -50)

pnpm --filter @orca/db generate
pnpm --filter @orca/db exec prisma migrate deploy
```

**المتوقع:**
```
N migrations found in prisma/migrations
Applying migration `20260426040102_init`
...
All migrations have been successfully applied.
```

**إن فشل:**
- `P1001: Can't reach database` → تأكد `.env DATABASE_URL` صحيح. اختبر: `psql "$DATABASE_URL" -c "SELECT 1"`.
- `P3009: migrate found failed migrations` → migration سابق فشل. `pnpm --filter @orca/db exec prisma migrate resolve --applied <migration_name>`.
- `permission denied for schema public` → `sudo -u postgres psql -d orca -c "GRANT ALL ON SCHEMA public TO orca;"`.

📝 **سجّل عدد migrations المطبقة:**
```
___________
```

---

### الخطوة 14 — Seed قاعدة البيانات (Plans + Admin)

```bash
cd ~/orca
DATABASE_URL="<copy from .env>" pnpm --filter @orca/db exec tsx prisma/seed.ts
```

**إن لم يكن seed.ts موجود أو فشل:**

أنشئ admin user يدوياً بعد تشغيل الـ API:
```bash
# سنفعل هذا لاحقاً بعد التشغيل
```

---

### الخطوة 15 — بناء المشروع

```bash
cd ~/orca
pnpm build
```

**المتوقع:** 2-4 دقائق. يبني `packages/*` ثم `apps/*`.

**إن فشل:**
- `tsc errors` → نسخة الكود قد تكون قديمة. `git pull`.
- `Out of memory` → الـ RAM قليل. زد swap:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  # أعد البناء
  ```
- `Module not found` → أعد `pnpm install`.

---

### الخطوة 16 — إعداد logs directory

```bash
cd ~/orca
mkdir -p logs
ls -la logs
```

---

## 🟦 الجزء الثالث — تشغيل الخدمات مع PM2

### الخطوة 17 — تشغيل أول مرة

```bash
cd ~/orca
pm2 start ecosystem.config.cjs
pm2 status
```

**المتوقع:** 3 خدمات `online`:
```
orca-api      online
orca-engine   online
orca-web      online
```

**إن إحداها `errored`:**
```bash
pm2 logs orca-api --lines 100  # أو engine/web
```
انسخ الـ error هنا 👇 وأرسله لي.

---

### الخطوة 18 — التحقق من الـ API يستجيب محلياً

```bash
curl -s http://127.0.0.1:4000/api/v1/health | head -50
```

**المتوقع:** JSON بـ `"ok": true`.

**إن فشل:**
- `Connection refused` → الـ API لم يبدأ. `pm2 logs orca-api`.
- Timeout → الـ API بدأ لكنه يحاول الاتصال بـ DB أو Redis ويفشل.

```bash
curl -s http://127.0.0.1:3000/ | head -20
```

**المتوقع:** HTML من Next.js.

---

### الخطوة 19 — ⭐ تفعيل الإقلاع التلقائي

```bash
pm2 startup systemd
```

**انسخ السطر الذي يطبعه ونفّذه** (يبدأ بـ `sudo env PATH=...`):

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u orca --hp /home/orca
```

```bash
pm2 save
```

**تحقق:**
```bash
sudo systemctl status pm2-orca   # → active (running)
```

**اختبر فعلياً:**
```bash
sudo reboot
# انتظر دقيقة، اتصل مرة أخرى:
ssh orca@77.223.215.36
pm2 status   # يجب أن تكون الثلاث online
```

---

## 🟦 الجزء الرابع — Nginx + SSL

### الخطوة 20 — تركيب Nginx + Certbot

```bash
# كـ root أو sudo
sudo apt install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

**تحقق:** `curl http://77.223.215.36` → Welcome to nginx.

---

### الخطوة 21 — إعداد ملف الموقع

```bash
sudo nano /etc/nginx/sites-available/orcax
```

**الصق هذا المحتوى:**

```nginx
server {
    listen 80;
    server_name orcax.click www.orcax.click;
    # سيُعدّل Certbot هذا تلقائياً ليعيد توجيه إلى HTTPS
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    server_name orcax.click www.orcax.click;

    # SSL — سيملؤها Certbot
    ssl_certificate     /etc/letsencrypt/live/orcax.click/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/orcax.click/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header Strict-Transport-Security "max-age=31536000" always;
    client_max_body_size 10M;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
    }

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

```bash
sudo ln -s /etc/nginx/sites-available/orcax /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t      # → syntax is ok
sudo systemctl reload nginx
```

> ⚠️ ستظهر أخطاء عن SSL certificates لأنها لم تُولّد بعد — هذا طبيعي. الخطوة التالية ستحلّها.

---

### الخطوة 22 — التحقق من DNS قبل SSL

```bash
dig +short orcax.click
dig +short www.orcax.click
```

**كلاهما يجب أن يُرجع `77.223.215.36`.**

**إن لم يفعل:** ارجع لوحة الـ DNS عند مزود الـ domain، أضف:
```
A    @       77.223.215.36
A    www     77.223.215.36
```
انتظر 5-15 دقيقة للـ propagation ثم أعد `dig`.

---

### الخطوة 23 — توليد شهادة SSL

```bash
sudo certbot --nginx -d orcax.click -d www.orcax.click \
  --email YOUR_EMAIL@example.com --agree-tos --no-eff-email
```

**المتوقع:** `Successfully deployed certificate`.

**إن فشل:**
- `DNS problem: NXDOMAIN` → DNS لم ينتشر. انتظر وأعد.
- `Connection refused` → port 80 محجوب. تأكد UFW يسمح بـ 80.
- `Too many requests` → تم تجاوز Let's Encrypt rate limit. انتظر ساعة.

**تحقق:**
```bash
curl -I https://orcax.click
# → HTTP/2 200
```

**التجديد التلقائي:**
```bash
sudo systemctl status certbot.timer   # → active (waiting)
sudo certbot renew --dry-run         # اختبار التجديد
```

---

### الخطوة 24 — افتح المتصفح

اذهب إلى **https://orcax.click**.

**المتوقع:** صفحة Orca تظهر بشهادة صالحة 🔒.

**إن ظهرت أخطاء:**

| المشكلة | الحل |
|---------|-----|
| `502 Bad Gateway` | `pm2 status` — تأكد orca-web و orca-api يعملان. `pm2 logs --lines 50`. |
| `WebSocket failed to connect` | مقطع `/socket.io/` غير موجود في Nginx. ارجع للخطوة 21. |
| `Cannot reach API` | `NEXT_PUBLIC_API_URL` خاطئ — يجب أن يكون `https://orcax.click/api/v1`. عدّل `.env` وأعد `pnpm --filter @orca/web build && pm2 restart orca-web`. |
| `CORS error` | `API_CORS_ORIGIN` خاطئ في `.env`. عدّله إلى `https://orcax.click` ثم `pm2 restart orca-api`. |
| صفحة بيضاء | `pm2 logs orca-web` — قد يكون build فشل. |

---

## 🟦 الجزء الخامس — تشغيل واختبار

### الخطوة 25 — إنشاء حساب الـ Admin

من المتصفح:
1. اذهب `https://orcax.click/register`.
2. أنشئ حساب بـ email و password قوي.
3. **رجوعاً للسيرفر**، ارفع المستخدم إلى SUPER_ADMIN:

```bash
sudo -u postgres psql -d orca -c "UPDATE \"User\" SET role='SUPER_ADMIN' WHERE email='YOUR_EMAIL';"
```

4. سجّل دخول → ادخل `/admin`.

---

### الخطوة 26 — فعّل أمان الأدمن (مهم)

من `/admin/security`:
1. **Require 2FA for admin access** — فعّل.
2. **IP Allowlist** — أضف IP جهازك (`curl ifconfig.me` من جهازك). يمنع وصول الأدمن من IPs أخرى.
3. **قبل تفعيل أيٍ منهما، ادخل `/settings/security` وفعّل 2FA على حسابك أولاً.**

---

### الخطوة 27 — اختبار سريع

```bash
# الخدمات
pm2 status

# Health
curl -s https://orcax.click/api/v1/health | jq

# الـ Web
curl -I https://orcax.click

# الـ DB
sudo -u postgres psql -d orca -c "SELECT count(*) FROM \"User\";"

# Redis
redis-cli ping
```

---

## 🟦 الجزء السادس — نسخ احتياطي + مراقبة

### الخطوة 28 — Cron للنسخ الاحتياطي اليومي

```bash
mkdir -p ~/orca/backups ~/orca/scripts
cat > ~/orca/scripts/backup-db.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="$HOME/orca/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date -u +"%Y-%m-%d_%H-%M-%S")
FILE="$BACKUP_DIR/orca_$TS.sql.gz"
DB_URL=$(grep -E '^DATABASE_URL' "$HOME/orca/.env" | cut -d= -f2- | tr -d '"')
PG_PASS=$(echo "$DB_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
PGPASSWORD="$PG_PASS" pg_dump --no-owner --no-privileges -U orca -h localhost orca | gzip > "$FILE"
find "$BACKUP_DIR" -name "orca_*.sql.gz" -mtime +14 -delete
echo "Backup: $FILE ($(du -h "$FILE" | cut -f1))"
SCRIPT
chmod +x ~/orca/scripts/backup-db.sh

# اختبر
~/orca/scripts/backup-db.sh

# جدوله
(crontab -l 2>/dev/null; echo "0 3 * * * /home/orca/orca/scripts/backup-db.sh >> /home/orca/orca/logs/backup.log 2>&1") | crontab -
crontab -l
```

---

### الخطوة 29 — سكربت deploy للتحديثات

```bash
cat > ~/orca/deploy.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "→ git pull"
git pull origin main
echo "→ pnpm install"
pnpm install --frozen-lockfile
echo "→ prisma migrate"
export $(grep -v '^#' .env | xargs -d '\n' | head -20)
pnpm --filter @orca/db generate
pnpm --filter @orca/db exec prisma migrate deploy
echo "→ build"
pnpm build
echo "→ pm2 restart"
pm2 restart all
sleep 3
pm2 status
SCRIPT
chmod +x ~/orca/deploy.sh
```

استخدامه لاحقاً: `cd ~/orca && ./deploy.sh`.

---

## 📋 مرجع سريع: الأوامر اليومية

```bash
# الحالة
pm2 status
pm2 logs --lines 50

# إعادة التشغيل
pm2 restart all
pm2 restart orca-api

# تحديث
cd ~/orca && ./deploy.sh

# Backup يدوي
~/orca/scripts/backup-db.sh

# Nginx
sudo nginx -t
sudo systemctl reload nginx

# SSL renewal
sudo certbot renew

# سجلات Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# مراقبة الموارد
htop
pm2 monit
df -h
```

---

## 🆘 سجل الأخطاء التي واجهتها أنا

> **استخدم هذا القسم لتسجيل أي خطأ تواجهه + الحل**، حتى تستفيد منه في تركيب لاحق.

### خطأ #1
**عند الخطوة:** ______
**الرسالة:**
```
______
```
**الحل:**
```
______
```

### خطأ #2
**عند الخطوة:** ______
**الرسالة:**
```
______
```
**الحل:**
```
______
```

---

## ✅ قائمة فحص نهائية (Production-ready)

- [ ] الخطوة 1-9: السيرفر مُجهز (Node + pnpm + PM2 + Postgres + Redis).
- [ ] الخطوة 10-12: المشروع مُنزل و dependencies مُثبتة.
- [ ] الخطوة 13-15: DB migrated و build ناجح.
- [ ] الخطوة 17-19: الخدمات الثلاث تعمل + إقلاع تلقائي.
- [ ] الخطوة 20-23: Nginx + SSL يعملان.
- [ ] الخطوة 24: `https://orcax.click` يفتح بدون أخطاء.
- [ ] الخطوة 25: حساب admin منشأ ومرفّع إلى SUPER_ADMIN.
- [ ] الخطوة 26: 2FA + IP allowlist مفعّلان.
- [ ] الخطوة 28-29: Backups و deploy script جاهزان.
- [ ] أسرار `.env` مُنشأة عشوائياً (ليست الافتراضية).
- [ ] كلمة root SSH غُيّرت بعد المحادثة.

---

**ابدأ الآن بالخطوة 1. عند أي خطأ، انسخ الـ output ولاحظ الخطوة، وأرسلها لي.**
