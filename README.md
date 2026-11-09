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

## Food image scans

The mobile scanner uploads one resized JPEG and recognizes up to 12 distinct food types in one AI request. Alternatives for a single food stay inside its `candidates` array. Each food has its own quantity, category, storage, expiry estimate and nutrition.

All scan endpoints require the existing bearer token:

- `POST /api/ai/scan-jobs?ownerType=USER` accepts multipart `image` (JPEG, PNG or WebP, maximum 8 MB) and returns `202` with a job ID.
- `GET /api/ai/scan-jobs/:id` returns status, processing stage, stage-based progress and the completed result. Only the creating user can read a job.
- `DELETE /api/ai/scan-jobs/:id` cancels pending work. Cancellation stops local processing but cannot guarantee that the AI provider stops billing a request already received.

Upload progress is measured by the client. Server progress advances at real stage boundaries; it does not estimate internal model completion. AI requests share a 25-second budget across model attempts (`GEMINI_SCAN_TIMEOUT_MS` can override this, up to 45 seconds). Jobs have a 60-second processing deadline, two concurrent workers, a bounded queue and a three-minute result lifetime. Slow or failed scans can be retried with the captured image.

The queue is process-local. Restarting the API invalidates pending job IDs. Multiple API instances need a shared job store/queue or sticky routing before production scaling. Scan results are audited in MongoDB; inventory is changed only when the user reviews and saves a food through the existing form.

Run the focused regression checks with `npm run test:scan`.

### Reviewed batches and photo provenance

Storage advice also covers apples, pineapple, ripe avocado, dairy butter, pasteurized milk and selected cheese types. `/api/ai/storage-guidance` accepts optional `storageProfile` and `packaging`, and returns `guide`, `message`, `profiles` and `recommendedStorage`. A missing guide still includes next steps. Product form/opening state is confirmed by the user; UHT milk follows manufacturer instructions. Dates anchored to purchase are not restarted on opening. Sources: [Nebraska Extension](https://food.unl.edu/free-resource/food-storage/) and [Newfoundland & Labrador](https://www.gov.nl.ca/healthyeating/veggiesandfruit/storage/vegetables-and-fruits-storage/) (reviewed 2026-11-08).

Completed jobs now return a persistent `scanResultId`. Use it for `GET /api/ai/scan-batches/:id/review`, `POST /api/ai/scan-batches/:id/image` (the exact JPEG used for scanning), and `POST /api/ai/scan-batches/:id/items`. The image endpoint checks the scan's SHA-256 digest and uploads the full scene once. Each saved food links to the original scene and stores a Cloudinary crop generated from a validated normalized `[top,left,bottom,right]` region. Missing regions use no individual photo, never the whole scene as an item thumbnail. Supplemental images keep their own source ID while retaining the original purchase-batch ID.

Only selected, reviewed items are submitted. The frontend sends groups of six with stable item keys and keeps successful rows locked. A partial failure can be retried; a unique partial index on `(createdBy, scanResultId, scanItemKey)` prevents a second insertion for the same row. Similar existing foods need an explicit new-lot decision; portions can have distinct container labels without doubling the original quantity. Uncertain responses require reconciliation before rows can be split or replaced. The existing startup index creation installs the new index.

`POST /api/ai/storage-guidance` returns a conservative, condition-specific reminder from the cited FoodSafety.gov chart for supported named foods. Unknown states/unsupported foods require a package date or user-confirmed date. AI estimates no longer set the reviewed batch's shelf life. `REFERENCE` reminders become `NEED_CHECK` after their target date; they are not a safety/expiry determination. Package dates are retained separately and cannot be silently extended by a reference reminder. Original-image dates record the scan event; the user confirms the purchase date.

## Owns

- API routes
- OpenAPI contract
- Database schema, migrations, seeds
- Business rules and validation
