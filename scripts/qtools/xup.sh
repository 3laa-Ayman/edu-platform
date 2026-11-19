#!/bin/bash
# usage: xup.sh <xlsx>  (local test server only: starts postgres + server if needed, logs in as the seed admin, uploads)
cd /home/user/edu-platform
if [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' localhost:4000/)" != 200 ]; then
  D=/var/lib/postgresql/edu; su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D/data -l $D/log -o '-k /tmp -p 5432' start" >/dev/null 2>&1; sleep 3
  (nohup node src/server.js > /tmp/claude-0/-home-user-edu-platform/b108f406-aac0-58e7-9a5a-fb6342c06aa3/scratchpad/server.log 2>&1 &); sleep 4
fi
psql -h localhost -U edu edu_platform -qc "delete from rate_limits" >/dev/null
T=$(curl -s localhost:4000/api/auth/login -H 'content-type: application/json' -d '{"identifier":"admin@example.com","password":"ChangeMe!2026"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")
curl -s localhost:4000/api/admin/questions/upload -H "authorization: Bearer $T" -F "file=@$1"; echo
