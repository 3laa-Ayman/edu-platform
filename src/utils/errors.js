class AppError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  AppError,
  badRequest: (msg = 'طلب غير صالح', details) => new AppError(400, msg, 'BAD_REQUEST', details),
  unauthorized: (msg = 'يجب تسجيل الدخول') => new AppError(401, msg, 'UNAUTHORIZED'),
  forbidden: (msg = 'غير مسموح لك بهذا الإجراء', code = 'FORBIDDEN', details) => new AppError(403, msg, code, details),
  notFound: (msg = 'غير موجود') => new AppError(404, msg, 'NOT_FOUND'),
  conflict: (msg = 'تعارض في البيانات') => new AppError(409, msg, 'CONFLICT'),
  tooMany: (msg = 'محاولات كثيرة، حاول لاحقاً') => new AppError(429, msg, 'TOO_MANY_REQUESTS'),
};
