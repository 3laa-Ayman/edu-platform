/** Shared zod field schemas (registration, admin forms). */
const { z } = require('zod');

const egyptPhone = z.string().trim().regex(/^01[0125]\d{8}$/, 'رقم هاتف مصري غير صحيح (مثال: 01012345678)');
const email = z.string().trim().toLowerCase().email('بريد إلكتروني غير صحيح').max(255);
const password = z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(72)
  .regex(/[A-Za-z]/, 'كلمة المرور يجب أن تحتوي على حروف').regex(/\d/, 'كلمة المرور يجب أن تحتوي على أرقام');
const fullName = z.string().trim().min(3).max(120);

module.exports = { egyptPhone, email, password, fullName };
