const { ZodError } = require('zod');
const multer = require('multer');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'البيانات المرسلة غير صحيحة',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الملف أكبر من المسموح' : 'خطأ في رفع الملف';
    return res.status(400).json({ error: { code: err.code, message: msg } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'JSON غير صالح' } });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'البيانات موجودة بالفعل' } });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: { code: 'INVALID_REFERENCE', message: 'مرجع غير موجود' } });
  }

  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'حدث خطأ غير متوقع', ...(env.isProd ? {} : { debug: err.message }) },
  });
};
