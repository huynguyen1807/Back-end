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
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster-url>/freshfriends?retryWrites=true&w=majority&appName=FreshFriends
MONGODB_DB_NAME=freshfriends
```

The server connects through Mongoose on startup and creates the core indexes for the FreshFriends collections.

## Owns

- API routes
- OpenAPI contract
- Database schema, migrations, seeds
- Business rules and validation
