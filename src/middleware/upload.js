const path = require('path');
const multer = require('multer');
const { badRequest } = require('../utils/errors');

// Serverless hosts (e.g. Vercel) cap request bodies at ~4.5MB.
const MAX_UPLOAD = 4 * 1024 * 1024;
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel question sheets — kept in memory, parsed, then discarded. */
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1 },
  fileFilter: (req, file, cb) => {
    const okExt = path.extname(file.originalname).toLowerCase() === '.xlsx';
    const okMime = [XLSX_MIME, 'application/octet-stream'].includes(file.mimetype);
    cb(okExt && okMime ? null : badRequest('يجب رفع ملف Excel بصيغة .xlsx'), okExt && okMime);
  },
});

/** Payment receipts — kept in memory and stored in the database (bytea). */
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = RECEIPT_TYPES.includes(file.mimetype);
    cb(ok ? null : badRequest('الإيصال يجب أن يكون صورة (JPG/PNG/WEBP) أو PDF'), ok);
  },
});

/** Question images — validated again by content (magic bytes) before saving. */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(ok ? null : badRequest('الصورة يجب أن تكون PNG / JPG / WEBP / GIF'), ok);
  },
});

module.exports = { excelUpload, receiptUpload, imageUpload };
