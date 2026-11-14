# النسخ الاحتياطي لقاعدة البيانات

كل يوم الساعة 3:30 الفجر تقريباً، GitHub Actions بياخد **نسخة كاملة** من قاعدة البيانات (الطلاب، الأسئلة والصور، المدفوعات
والإيصالات، المسابقات، كل حاجة)، **يشفّرها** بباسورد، ويحتفظ بآخر **30 نسخة** — بره Neon، فلو حصل أي حاجة لقاعدة البيانات
البيانات مش هتضيع. الملف: `.github/workflows/db-backup.yml`.

## التجهيز (مرة واحدة)

في GitHub: صفحة المشروع ← **Settings** ← **Secrets and variables** ← **Actions** ← **New repository secret**، وضيف اتنين:

| الاسم | القيمة |
|---|---|
| `BACKUP_DATABASE_URL` | رابط قاعدة البيانات من Neon (نفس `DATABASE_URL` اللي على Vercel) |
| `BACKUP_PASSPHRASE` | باسورد طويل تختاره — **احفظه في مكان آمن**؛ من غيره النسخ مش هتتفتح |

بعدها: **Actions** ← **Daily database backup** ← **Run workflow** عشان تاخد أول نسخة وتتأكد إنها شغالة (لازم تبقى ✅ خضرا).

## تنزيل نسخة

**Actions** ← **Daily database backup** ← اختار اليوم ← تحت **Artifacts** نزّل `edu-db-<التاريخ>` (ملف zip جواه `.dump.gpg`).

## الاسترجاع

محتاج جهاز عليه `gpg` و `pg_restore` (Postgres 16 أو أحدث):

```bash
# 1) فك التشفير (هيطلب BACKUP_PASSPHRASE)
gpg -d -o db.dump edu-db-2026-11-14_0130.dump.gpg

# 2) استرجاع في قاعدة بيانات جديدة فاضية (مثلاً branch أو مشروع جديد في Neon)
pg_restore --no-owner --no-privileges -d "postgres://...رابط القاعدة الجديدة..." db.dump
```

وبعدين غيّر `DATABASE_URL` على Vercel للقاعدة الجديدة واعمل Redeploy.

> ⚠️ ماتسترجعش فوق قاعدة البيانات الشغالة مباشرة — استرجع في قاعدة جديدة واتأكد منها الأول.
