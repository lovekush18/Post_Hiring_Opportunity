# Passage — Full-stack foundation

This package preserves the supplied Passage prototype UI and adds a PostgreSQL-backed REST API for authentication, employee profiles/skills, opportunities, candidate matching, applications, manager assignment, growth records, passport snapshots and HR analytics.

## Stack
- Existing responsive HTML/CSS/JS prototype (`frontend.html`)
- Node.js + Express REST API
- PostgreSQL 16 + Prisma ORM
- JWT authentication, bcrypt password hashing, Zod validation, Helmet and rate limiting

## Run the database
From the project root:
```bash
docker compose up -d
```

## Run the API
```bash
cd backend
cp .env.example .env
# Keep DATABASE_URL for the included Docker Compose database.
# Replace JWT_SECRET with a random secret of 32+ characters.
npm install
npx prisma generate
npx prisma db push
npm run dev
```
API health check: `http://localhost:4000/api/health`

## API overview
| Method | Endpoint | Access |
|---|---|---|
| POST | `/api/auth/register` | Public; creates employee by default; accepts role during development |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Signed-in user |
| GET/PATCH | `/api/profile` | Signed-in user; own profile |
| PUT | `/api/profile/skills` | Signed-in user; own skills |
| GET | `/api/opportunities` | Signed-in user |
| POST/PATCH | `/api/opportunities` | Manager/HR |
| GET | `/api/opportunities/:id/matches` | Manager/HR |
| POST | `/api/opportunities/:id/apply` | Employee |
| GET | `/api/applications` | Employee sees own; manager/HR see all |
| PATCH | `/api/applications/:id/status` | Manager/HR |
| POST | `/api/assignments` | Manager/HR |
| GET/POST | `/api/growth-records` | Signed-in user; employees see own records |
| POST/GET | `/api/passport/snapshot`, `/api/passport/versions` | Signed-in user |
| GET | `/api/hr/analytics`, `/api/hr/users` | HR |

Send `Authorization: Bearer <token>` on protected requests. JSON request bodies are validated. The match endpoint implements the prototype's weighted fit model (skills 50%, experience 15%, career alignment 15%, performance 10%, workload 10%); its workload factor is currently a neutral 100 until assignment capacity rules are configured.

## Important integration note
The supplied HTML is preserved unchanged as `frontend.html`. It currently contains browser-local account/state persistence and inline event handlers. The API is implemented separately and is ready for the frontend integration step; the original prototype does **not** automatically become database-backed merely by copying this package. Do not use the prototype's role picker as production authorization: in production, users should not be allowed to self-select HR/Manager roles. Restrict role assignment to an HR/admin provisioning workflow. Also configure a production CORS origin, strong JWT secret, HTTPS, database backups, and an email/password reset flow before deployment.

## Sample API calls
Register:
```bash
curl -X POST http://localhost:4000/api/auth/register -H 'Content-Type: application/json' -d '{"name":"Demo Employee","email":"demo@example.com","password":"ChangeThisPassword123"}'
```
Health:
```bash
curl http://localhost:4000/api/health
```

`frontend-api.js` provides a typed-by-convention browser helper (`window.PassageAPI`) for the endpoints. It is an integration helper, not an automatic patch to the original HTML. The original inline UI needs its auth handlers and state-loading/rendering functions connected to these API calls before all screens persist to PostgreSQL. This is intentionally called out rather than claiming that the supplied prototype has already been converted.
