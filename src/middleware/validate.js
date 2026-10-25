const { z } = require('zod');

/**
 * Validates and coerces request input with zod. Unknown body keys are stripped.
 * Parsed values: req.body (replaced), req.q (query), req.p (params).
 */
const validate = ({ body, query, params } = {}) => (req, res, next) => {
  if (params) req.p = params.parse(req.params);
  if (query) req.q = query.parse(req.query);
  if (body) req.body = body.parse(req.body ?? {});
  next();
};

const idParam = z.object({ id: z.coerce.number().int().positive() });
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

module.exports = { validate, idParam, pagination, z };
