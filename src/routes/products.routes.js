const router = require('express').Router();
const db = require('../config/db');
const { validate, z } = require('../middleware/validate');

/** Study products & discounts (public). */
router.get('/', validate({ query: z.object({ category: z.string().max(60).optional() }) }), async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, title, description, image_url, category, original_price, discount_percent, final_price, coupon_code, external_url
       FROM products WHERE is_active AND ($1::text IS NULL OR category = $1)
      ORDER BY discount_percent DESC, created_at DESC`,
    [req.q.category ?? null],
  );
  res.json({ products: rows });
});

module.exports = router;
