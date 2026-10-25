/**
 * Atomically generates the next student code for the current year: STU-2026-0001, STU-2026-0002 ...
 * Uses an UPSERT on a per-year counter row, so it is safe under concurrent registrations
 * (and rolls back together with the surrounding transaction).
 */
async function nextStudentCode(client) {
  const year = new Date().getFullYear();
  const { rows } = await client.query(
    `INSERT INTO student_code_counters (year, last_value) VALUES ($1, 1)
     ON CONFLICT (year) DO UPDATE SET last_value = student_code_counters.last_value + 1
     RETURNING last_value`,
    [year],
  );
  return `STU-${year}-${String(rows[0].last_value).padStart(4, '0')}`;
}

module.exports = { nextStudentCode };
