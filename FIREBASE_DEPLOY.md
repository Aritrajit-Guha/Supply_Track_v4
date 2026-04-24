# Firebase Hosting Deploy Notes

This project is prepared for frontend-only deployment on Firebase Hosting.
The Flask backend stays external and must be deployed separately.

## Required frontend environment variable

Create `frontend/.env` with:

```env
VITE_BACKEND_URL=https://your-backend-api.example.com
```

The backend must expose the same `/api/*` routes and Socket.IO endpoint used in local development.

## Deploy steps

1. Install Firebase CLI if needed:
   - `npm install -g firebase-tools`
2. Log in:
   - `firebase login`
3. Update `.firebaserc` with your real Firebase project id.
4. Build the frontend:
   - `cd frontend`
   - `npm run build`
5. Deploy from the repo root:
   - `firebase deploy --only hosting`

## Notes

- `firebase.json` already points Hosting to `frontend/dist`
- SPA rewrites are enabled, so routes like `/fleet` and `/truck/T-1001` resolve correctly
- Before production, the backend should allow the Firebase Hosting domain in CORS and Socket.IO origins
