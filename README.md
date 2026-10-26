# منصة تعليمية — MVP

Node.js (Express 5) + PostgreSQL + واجهة ويب عربية (طالب + أدمن) يعرضها نفس السيرفر على `/`.
كل المواصفات مبنية في الكود ومختبرة باختبار تشغيلي كامل (`npm run test:smoke` → 92 فحص).

## النشر برابط أونلاين (Vercel + Neon — مجاناً بدون كارت)

**1) قاعدة البيانات — [neon.tech](https://neon.tech):** سجّل بـ GitHub ← أنشئ Project (منطقة Frankfurt) ← انسخ الـ **Connection string**.

**2) السيرفر والواجهة — [vercel.com](https://vercel.com):** سجّل بـ GitHub ← **Add New → Project** ← اختر المستودع ← افتح **Environment Variables** وضيف:

| Key | Value |
|---|---|
| `DATABASE_URL` | الـ Connection string من Neon |
| `JWT_SECRET` | نص عشوائي طويل (32 حرف أو أكتر) |
| `ADMIN_PASSWORD` | كلمة سر الأدمن |
| `NODE_ENV` | `production` |
| `DEMO_MODE` | `true` |
| `OTP_DEV_ECHO` | `true` |
| `CRON_SECRET` | نص عشوائي (لتشغيل المهام المجدولة) |

ثم **Deploy**. أول طلب بيجهّز الجداول ويعمل حساب الأدمن (`admin@example.com`) و6 أسئلة تجريبية تلقائياً.

- `api/index.js` هو نقطة الدخول على Vercel، و`vercel.json` فيه المهام المجدولة (توزيع التيمات الخميس، تقارير السبت، تنظيف يومي).
- الإيصالات بتتخزن في قاعدة البيانات (مفيش اعتماد على ملفات السيرفر)، وأقصى حجم للملف 4MB.
- `DEMO_MODE=true`: OTP بيظهر على الشاشة، الدفع محاكاة، وشرح AI تجريبي. **للإطلاق الحقيقي:** `DEMO_MODE=false` + مفاتيح Paymob / Fawry / Gemini / SMTP.

بديل: `render.yaml` جاهز للنشر على Render (بيطلب كارت)، أو أي سيرفر بـ `npm run start:render`.

## التشغيل السريع

```bash
npm install
cp .env.example .env            # عدّل JWT_SECRET و ADMIN_PASSWORD
docker compose up -d db         # أو استخدم PostgreSQL موجود عندك وعدّل DATABASE_URL
npm run db:migrate              # ينشئ الجداول (آمن للتشغيل أكثر من مرة)
npm run db:seed                 # ينشئ حساب الأدمن + منتجات تجريبية
npm run dev                     # http://localhost:4000
```

اختبار شامل (والسيرفر شغال، مع `OTP_DEV_ECHO=true` و `AUTH_RATE_LIMIT=200`):
```bash
PAYMOB_HMAC_SECRET=testsecret npm run test:smoke   # نفس القيمة اللي السيرفر شغال بيها
```

> في وضع التطوير: لو مفاتيح Gemini أو Paymob أو Fawry فاضية، النظام يستخدم ردود تجريبية (mock)، والإيميلات بتتطبع في الـ console. في `production` النظام يرفض التشغيل بدون المفاتيح.

## هيكل المشروع

```
db/schema.sql                 قاعدة البيانات كاملة (25 جدول)
src/
  app.js / server.js          Express + Helmet + CORS + Rate limit + معالج الأخطاء
  config/                     env + pool الاتصال بـ PostgreSQL
  middleware/                 auth (JWT) · subscription · rateLimit · validate (zod) · upload (multer)
  services/
    otp.service.js            توليد/تحقق OTP (مخزن كـ HMAC، 5 محاولات، صلاحية 10 دقائق)
    answer.service.js         تسجيل الإجابة + تحديث بنك الأخطاء تلقائياً
    ai.service.js             Gemini 2.5 Flash Lite + حساب التوكنز والتكلفة + سقف الإنفاق
    excel.service.js          قراءة شيت الأسئلة (عناوين عربي/إنجليزي) والتحقق والاستيراد
    payment.service.js        Paymob / Fawry + التحقق من التوقيعات + تفعيل الاشتراك
    team.service.js           خوارزمية التوزيع العشوائي للتيمات
    competition.service.js    خلط الأسئلة والاختيارات + التصحيح + الترتيب
    report.service.js         تقارير ولي الأمر
    stats.service.js          نسب الأداء لكل مادة
  routes/                     نقاط الـ API (بالأسفل)
  jobs/                       مهام مجدولة (توزيع التيمات الخميس، تقارير السبت، تنظيف يومي)
api/index.js                  نقطة الدخول على Vercel (serverless)
public/                       واجهة الويب (HTML/CSS/JS بدون build): صفحات الطالب والأدمن
scripts/                      migrate · seed · make-excel-template · smoke-test · demo
templates/questions-template.xlsx   نموذج شيت الأسئلة
```

## كيف تم تنفيذ كل متطلب

| المتطلب | التنفيذ |
|---|---|
| **التسجيل (3 خطوات)** | ① `POST /api/auth/register`: الاسم، الإيميل، رقم الطالب، رقم ولي الأمر (وإيميل ولي الأمر اختياري) — **من غير باسورد** ← OTP على الإيميل (أرخص من SMS). ② `POST /api/auth/verify-otp` ← `setup_token` صالح 30 دقيقة ولمرة واحدة. ③ `POST /api/auth/set-password` ← الباسورد يتشفر bcrypt (12 rounds) ويتعمل الـ ID ويدخل على حسابه. الـ OTP من 6 أرقام بـ `crypto.randomInt` ويتخزن hash فقط. التسجيلات اللي مكملتش بتتمسح بعد 7 أيام. |
| **ID الطالب** | `STU-2026-0001` من عداد سنوي ذري (`student_code_counters`) — **بيتعمل بعد تعيين الباسورد بس**، فالأرقام متسلسلة ومفيش أرقام ضايعة على تسجيلات ناقصة. الدخول بالإيميل أو بالكود. |
| **رفع Excel** | `POST /api/admin/questions/upload` (حقل `file`). يقبل عناوين عربي أو إنجليزي، الإجابة `A/B/C/D` أو `أ/ب/ج/د` أو نص الاختيار نفسه. التصنيف: `درس` / `امتحان سابق`. يُنشئ المواد والدروس تلقائياً، يتجاهل الأسئلة المكررة، ويرجع تقرير بالأخطاء لكل صف. `?dry_run=true` للفحص بدون حفظ. |
| **صور الأسئلة** | عمود **"صورة السؤال"** في الشيت: الصق الصورة جوه صف السؤال (Insert ← Pictures ← *Place over Cells*). مكانها بيحدد هي لإيه: عمود صورة السؤال/السؤال ← صورة السؤال، عمود اختيار ← صورة الاختيار (الاختيار ممكن يبقى صورة من غير نص)، عمود الشرح ← صورة الشرح. الصور بتتخزن في قاعدة البيانات (`question_media`)، وبيتأكد من نوعها من محتوى الملف نفسه، وبتظهر في التدريب والأخطاء والمسابقات والشرح، وبتتبعت لـ Gemini مع السؤال. الأدمن يقدر يضيف/يغيّر/يمسح أي صورة من نافذة السؤال (الصور الكبيرة بتتصغّر في المتصفح قبل الرفع). الحد: الصورة 2MB والملف كله 4MB. |
| **بنك الأخطاء** | أي إجابة خاطئة (تدريب أو مسابقة) تُضاف تلقائياً مع `wrong_count`، مصنفة بالمادة والدرس. `POST /api/mistakes/:id/retry` — لو صح يتحذف تلقائياً. |
| **Gemini + حد 100 جنيه** | الترتيب: شرح محفوظ في البنك (مجاني) ← شرح AI اتولد قبل كده لنفس السؤال (مجاني للكل) ← Gemini. التكلفة تُحسب من `usageMetadata` الفعلي. السقف محمي ضد الطلبات المتزامنة: يتم **حجز** أقصى تكلفة متوقعة بـ UPDATE ذري قبل الطلب ثم التسوية بالتكلفة الفعلية (أو الاسترداد لو فشل). عند الوصول للحد: `402 AI_LIMIT_REACHED`، وتنبيه لما يتبقى أقل من 20%. |
| **الاشتراكات** | عادي 149 / بريميم 299 (30 يوم، قابلة للتعديل في جدول `plans`). Paymob (Intention API) و Fawry (رقم مرجعي) مع Webhooks موقعة (HMAC-SHA512 / SHA-256) ومراجعة المبلغ، والتفعيل idempotent. فودافون كاش / انستاباي: رفع إيصال ← مراجعة الأدمن ← قبول/رفض. التجديد بيمدد من تاريخ الانتهاء. |
| **التيمات** | إنشاء تيم ← دعوة بالـ ID ← قبول/رفض (حد 4، أقفال على مستوى الصف لمنع تجاوز العدد). توزيع تلقائي كل خميس 9 م: خلط عشوائي (CSPRNG) ← إكمال التيمات الناقصة اللي سمحت بكده ← تقسيم الباقي لتيمات متوازنة (فرق الحجم ≤ 1). |
| **المسابقات** | `team_weekly` (الجمعة) و `individual_monthly`. كل طالب له ترتيب أسئلة وترتيب اختيارات مختلف، والتصحيح بيرجع للحرف الأصلي على السيرفر. وقت محدد لكل طالب، تسليم مرة واحدة، الإجابات الصحيحة تظهر بعد انتهاء المسابقة. Leaderboard للأفراد (الدرجة ثم الوقت) وللتيمات (مجموع الدرجات). |
| **تنظيم الوقت** | `/api/planner/tasks` — مهام يومية بوقت ومدة وأولوية ونسبة إنجاز. |
| **تقارير ولي الأمر** | تقرير أسبوعي (نسبة كل مادة، المسابقات والترتيب، المهام، الأخطاء المتبقية) يُرسل بالإيميل لو موجود وإلا SMS. تلقائي كل سبت + زر إرسال يدوي (مرة كل 24 ساعة). |
| **الخصومات والتقييمات** | `/api/products` (السعر بعد الخصم محسوب في قاعدة البيانات). `/api/reports/performance` نسبة الإجابات الصحيحة لكل مادة + تقدير (ممتاز / جيد جداً / ...). |
| **الأمان** | Helmet، CORS، Rate limiting (عام + دخول + OTP + AI + رفع ملفات)، JWT HS256 مع `token_version` لإلغاء كل الجلسات، كل الاستعلامات parameterized (`$1, $2`) ضد SQL Injection، تحقق zod لكل مدخل، رسائل موحدة ضد كشف الإيميلات، مقارنات timing-safe، أسماء ملفات عشوائية للإيصالات. |

> **قرار منتج قابل للتعديل:** أسئلة "الامتحانات السابقة" متاحة للبريميم فقط (`features.past_exams` في جدول `plans`) لتمييز الباقتين. باقي الميزات متاحة للباقتين.

## خريطة الـ API

كل المسارات تحت `/api`. المحمية تحتاج `Authorization: Bearer <token>`.

**Auth** — `POST /auth/register` · `/auth/verify-otp` · `/auth/set-password` · `/auth/resend-otp` · `/auth/login` `{identifier, password}` · `/auth/forgot-password` · `/auth/reset-password` · `/auth/logout-all` · `GET /auth/me`

**الأسئلة والتدريب** — `GET /catalog/subjects` · `GET /catalog/questions?subject_id&lesson_id&category&unsolved_only&limit` · `POST /catalog/answer {question_id, choice}` · `GET /catalog/questions/:id/explanation` (مجاني فقط)

**AI** — `POST /ai/explain/:questionId` · `GET /ai/usage`

**بنك الأخطاء** — `GET /mistakes/summary` · `GET /mistakes?subject_id&lesson_id&page` · `GET /mistakes/quiz` · `POST /mistakes/:questionId/retry {choice}`

**الدفع** — `GET /payments/plans` · `GET /payments/me` · `POST /payments/checkout {plan_code, provider: paymob|fawry}` · `POST /payments/manual` (multipart: `receipt`, `plan_code`, `provider: vodafone_cash|instapay`, `sender_account`, `transfer_ref`)
**Webhooks** — `POST /webhooks/paymob?hmac=...` · `POST /webhooks/fawry`

**التيمات** — `GET /teams/me` · `POST /teams {name}` · `PATCH /teams/me {name, allow_auto_fill}` · `POST /teams/invites {student_code}` · `GET /teams/invites` · `POST /teams/invites/:id/accept|decline` · `DELETE /teams/invites/:id` · `POST /teams/leave` · `DELETE /teams/members/:userId`

**المسابقات** — `GET /competitions?status&type` · `POST /competitions/:id/start` · `POST /competitions/:id/submit {answers:[{question_id, choice}]}` · `GET /competitions/:id/leaderboard` · `GET /competitions/:id/review`

**المذاكرة والتقارير** — `GET|POST /planner/tasks` · `PATCH|DELETE /planner/tasks/:id` · `GET /reports/performance` · `GET /reports/parent/preview` · `POST /reports/parent/send` · `GET /reports/parent/history` · `GET /products`

**الأدمن** — `GET /admin/dashboard` · `POST /admin/questions/upload` · `GET /admin/questions/template` · `GET /admin/questions` · `PATCH /admin/questions/:id` · `GET /admin/payments?status=under_review` · `GET /admin/payments/:id/receipt` · `POST /admin/payments/:id/approve|reject` · `GET /admin/students?search` · `PATCH /admin/students/:id {is_active, ai_limit_egp, reset_ai_spent}` · `POST /admin/competitions` · `POST /admin/teams/auto-assign` · `POST /admin/reports/send-weekly` · `GET /admin/ai-usage` · `POST|PUT|DELETE /admin/products`

مثال إنشاء مسابقة:
```json
POST /api/admin/competitions
{ "title": "مسابقة الجمعة", "type": "team_weekly",
  "starts_at": "2026-10-30T16:00:00+02:00", "ends_at": "2026-10-30T18:00:00+02:00",
  "duration_minutes": 30, "random": { "count": 20, "subject_id": 1 } }
```

## الـ Frontend المقترح

Next.js (App Router) + Tailwind (RTL) + React Query:
```
app/(auth)/register · verify · login · forgot-password
app/(student)/dashboard          ملخص: الاشتراك، رصيد AI، الأداء لكل مادة، مهام اليوم
app/(student)/practice           اختيار مادة/درس ← حل ← "عرض الشرح" (مجاني) ← "اشرح بالذكاء الاصطناعي"
app/(student)/mistakes           بنك الأخطاء مجمّع بالمادة/الدرس + إعادة الحل
app/(student)/competitions/[id]  مؤقت + أسئلة + leaderboard
app/(student)/team               التيم، الدعوات بالـ ID
app/(student)/planner            جدول المذاكرة اليومي
app/(student)/subscribe          الباقات + Paymob/Fawry + رفع الإيصال
app/(student)/offers             الخصومات
app/admin/*                      رفع Excel، مراجعة الإيصالات، الطلاب، المسابقات، المنتجات
```

## قبل الإنتاج (Production checklist)

- `NODE_ENV=production`، `JWT_SECRET` عشوائي ≥ 32 حرف، `CORS_ORIGINS` بدومين الواجهة فقط، HTTPS خلف Nginx.
- مفاتيح Paymob (Secret/Public/HMAC/Integration ID) وFawry (Merchant code/Secure key)، وتسجيل روابط الـ Webhook في لوحاتهم: `{APP_BASE_URL}/api/webhooks/paymob` و `/api/webhooks/fawry`. **راجع صيغ التوقيع مع الوثائق الحالية لكل بوابة واختبر على بيئة الـ staging أولاً.**
- `GEMINI_API_KEY` وراجع الأسعار الحالية (`GEMINI_INPUT_USD_PER_M` / `GEMINI_OUTPUT_USD_PER_M`) وسعر الدولار `USD_TO_EGP`.
- SMTP حقيقي للـ OTP والتقارير، ومزود SMS/WhatsApp في `sendSms` داخل `notify.service.js`.
- لو هتشغّل أكثر من نسخة من السيرفر: خلي `ENABLE_CRON=true` على نسخة واحدة فقط، واستخدم Redis store لـ express-rate-limit، والإيصالات متخزنة في قاعدة البيانات فمفيش مشكلة مع تعدد النسخ.
- نسخ احتياطي يومي لقاعدة البيانات.
