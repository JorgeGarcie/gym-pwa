// Google Drive backup sync using the `drive.file` scope.
//
// `drive.file` is the narrow, easy-to-approve scope: the app can only see and
// touch files it created itself — it has NO visibility into the rest of the
// user's Drive. We keep exactly one file, `gym-tracker-backup.json`, and
// overwrite it with the full entry list on each sync (single-user, so the local
// IndexedDB is the source of truth and Drive is a mirror).
//
// Auth uses Google Identity Services (GIS). We request an access token via the
// implicit token-client flow when the user clicks "Connect Drive"; the token
// lives in memory only (never persisted) and is refreshed on demand.

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const BACKUP_FILENAME = "gym-tracker-backup.json";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const FILE_ID_KEY = "gym-tracker-drive-file-id";

let tokenClient = null;
let accessToken = null;
let gisReady = null;

// Lazy-load the Google Identity Services script (only when the user opts in).
function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
  return gisReady;
}

export function isConfigured() {
  return Boolean(CLIENT_ID);
}

export function isConnected() {
  return Boolean(accessToken);
}

// Trigger the OAuth consent popup and resolve once we hold an access token.
export async function connect() {
  if (!CLIENT_ID) {
    throw new Error(
      "Missing VITE_GOOGLE_CLIENT_ID. Set it in .env.local (see README)."
    );
  }
  await loadGis();

  return new Promise((resolve, reject) => {
    tokenClient =
      tokenClient ||
      window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (resp) => {
          if (resp.error) return reject(new Error(resp.error));
          accessToken = resp.access_token;
          resolve();
        },
      });
    // prompt: "" reuses an existing grant silently when possible.
    tokenClient.requestAccessToken({ prompt: accessToken ? "" : "consent" });
  });
}

export function disconnect() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
}

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    accessToken = null;
    throw new Error("Drive token expired — reconnect.");
  }
  if (!res.ok) throw new Error(`Drive API error ${res.status}`);
  return res;
}

// Find our backup file. We first trust the cached fileId; if that's gone we
// search by name within the app's own file scope.
async function findBackupFileId() {
  const cached = localStorage.getItem(FILE_ID_KEY);
  if (cached) return cached;

  const q = encodeURIComponent(`name='${BACKUP_FILENAME}' and trashed=false`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`
  );
  const data = await res.json();
  const found = data.files?.[0]?.id || null;
  if (found) localStorage.setItem(FILE_ID_KEY, found);
  return found;
}

// Push the full entry array to Drive. Creates the file on first sync, updates
// it thereafter. Uses the multipart upload endpoint (metadata + content in one
// request). Returns the ISO timestamp we stamped on the backup.
export async function pushBackup(entries) {
  if (!accessToken) throw new Error("Not connected to Drive");

  const payload = {
    schema: 1,
    updatedAt: new Date().toISOString(),
    entries,
  };
  const body = JSON.stringify(payload);
  const fileId = await findBackupFileId();

  const boundary = "gym-tracker-boundary";
  const metadata = fileId
    ? {} // updating: don't resend name/parents
    : { name: BACKUP_FILENAME, mimeType: "application/json" };

  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${body}\r\n` +
    `--${boundary}--`;

  const method = fileId ? "PATCH" : "POST";
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`;

  const res = await driveFetch(url, {
    method,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  const data = await res.json();
  if (data.id) localStorage.setItem(FILE_ID_KEY, data.id);
  return payload.updatedAt;
}

// Pull the backup contents from Drive (for restore / cross-device load).
// Returns { updatedAt, entries } or null if no backup exists yet.
export async function pullBackup() {
  if (!accessToken) throw new Error("Not connected to Drive");
  const fileId = await findBackupFileId();
  if (!fileId) return null;
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  return res.json();
}
