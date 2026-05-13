#!/usr/bin/env bash
#
# generate-env.sh — يولد ملف .env إنتاجي لـ orcax.click بأسرار عشوائية
#
# الاستخدام:
#   ./scripts/generate-env.sh                # تفاعلي (يطلب كلمة DB)
#   ./scripts/generate-env.sh <DB_PASSWORD>  # يستخدم كلمة معطاة
#
# ينتج: .env (في جذر المشروع). يحفظ نسخة احتياطية لو موجود مسبقاً.

set -euo pipefail

cd "$(dirname "$0")/.."

TEMPLATE=".env.production.template"
OUTPUT=".env"

if [ ! -f "$TEMPLATE" ]; then
  echo "❌ لم يُعثر على $TEMPLATE في $(pwd)"
  exit 1
fi

# 1. كلمة مرور قاعدة البيانات
if [ -n "${1:-}" ]; then
  DB_PASS="$1"
else
  read -rsp "🔑 كلمة مرور قاعدة البيانات لـ orca (Enter لتوليد عشوائية): " DB_PASS
  echo
  if [ -z "$DB_PASS" ]; then
    DB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
    echo "✓ تم توليد كلمة مرور DB عشوائية"
  fi
fi

# 2. أسرار التطبيق
AUTH_SECRET=$(openssl rand -base64 64 | tr -d '\n')
ENC_SECRET=$(openssl rand -base64 32 | tr -d '\n')

# 3. احفظ نسخة احتياطية لو .env موجود
if [ -f "$OUTPUT" ]; then
  BACKUP=".env.backup.$(date -u +%Y%m%d_%H%M%S)"
  cp "$OUTPUT" "$BACKUP"
  echo "📦 .env القديم محفوظ في: $BACKUP"
fi

# 4. ولّد .env من القالب
#   sed مع | كفاصل لأن الأسرار قد تحوي / + =
sed \
  -e "s|__DB_PASSWORD__|$DB_PASS|g" \
  -e "s|__AUTH_SECRET__|$AUTH_SECRET|g" \
  -e "s|__ENCRYPTION_SECRET__|$ENC_SECRET|g" \
  "$TEMPLATE" > "$OUTPUT"

chmod 600 "$OUTPUT"

# 5. اعرض الأسرار (مرة واحدة فقط، احفظها)
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "✅ تم إنشاء $OUTPUT"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "🔐 الأسرار المولّدة (احفظها في مكان آمن — لن تظهر مرة أخرى):"
echo ""
echo "  DB_PASS:           $DB_PASS"
echo "  AUTH_SECRET:       ${AUTH_SECRET:0:24}...   (طوله ${#AUTH_SECRET})"
echo "  ENCRYPTION_SECRET: ${ENC_SECRET:0:24}...   (طوله ${#ENC_SECRET})"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📌 الخطوات التالية:"
echo ""
echo "  1. أنشئ المستخدم وقاعدة البيانات في Postgres:"
echo ""
echo "     sudo -u postgres psql <<EOF"
echo "     CREATE USER orca WITH PASSWORD '$DB_PASS' CREATEDB;"
echo "     CREATE DATABASE orca OWNER orca;"
echo "     GRANT ALL PRIVILEGES ON DATABASE orca TO orca;"
echo "     EOF"
echo ""
echo "  2. اختبر الاتصال:"
echo "     PGPASSWORD='$DB_PASS' psql -U orca -h localhost -d orca -c 'SELECT 1;'"
echo ""
echo "  3. طبّق migrations:"
echo "     cd $(pwd)"
echo "     export \$(grep -v '^#' .env | xargs)"
echo "     pnpm --filter @orca/db generate"
echo "     pnpm --filter @orca/db exec prisma migrate deploy"
echo ""
echo "  4. ابنِ وشغّل:"
echo "     pnpm build"
echo "     pm2 start ecosystem.config.cjs"
echo ""
echo "💡 الإعدادات الاختيارية (Telegram / Sentry / Resend / VAPID) فارغة"
echo "   حالياً. ادخل nano .env لإضافتها لاحقاً."
echo ""
