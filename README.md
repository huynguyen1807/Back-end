# Backend Repo

Node.js / Express API for Smart Household Food Management System.

## Run

```bash
npm install
npm run dev
```

## MongoDB Atlas

Create `backend/.env`:

```bash
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/?retryWrites=true&w=majority&appName=SHFMS
MONGODB_DB_NAME=freshfriends
```

The server connects through Mongoose on startup and creates the indexes defined by the SHFMS database design.

## Owns

- API routes
- OpenAPI contract
- Database schema, migrations, seeds
- Business rules and validation
