const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');
const { badRequest } = require('../utils/errors');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel question sheets — kept in memory, parsed, then discarded. */
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const okExt = path.extname(file.originalname).toLowerCase() === '.xlsx';
    const okMime = [XLSX_MIME, 'application/octet-stream'].includes(file.mimetype);
    cb(okExt && okMime ? null : badRequest('يجب رفع ملف Excel بصيغة .xlsx'), okExt && okMime);
  },
});

/** Payment receipts — stored on disk with a random name (never the user-supplied one). */
const RECEIPT_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: path.join(env.uploadDir, 'receipts'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${RECEIPT_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = Boolean(RECEIPT_TYPES[file.mimetype]);
    cb(ok ? null : badRequest('الإيصال يجب أن يكون صورة (JPG/PNG/WEBP) أو PDF'), ok);
  },
});

module.exports = { excelUpload, receiptUpload };
