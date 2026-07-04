// Tests the Drive sync layer with NO real Google contact. We mock the two seams
// drive.js depends on:
//   1. window.google.accounts.oauth2  — the GIS token client (OAuth)
//   2. global.fetch                    — every Drive REST call
// and assert we send the right requests and parse responses correctly.
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

let drive;
let tokenCallback;

// A fake GIS token client that immediately "grants" an access token.
function installGoogleMock() {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: ({ callback }) => {
          tokenCallback = callback;
          return {
            requestAccessToken: () => tokenCallback({ access_token: "fake-token" }),
          };
        },
        revoke: (_t, cb) => cb && cb(),
      },
    },
  };
}

beforeAll(async () => {
  // CLIENT_ID is read at module load, so stub the env before importing.
  vi.stubEnv("VITE_GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com");
  installGoogleMock();
  drive = await import("./drive.js");
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("isConfigured", () => {
  it("is true when a client id is present", () => {
    expect(drive.isConfigured()).toBe(true);
  });
});

describe("connect", () => {
  it("acquires a token from the GIS client", async () => {
    await drive.connect();
    expect(drive.isConnected()).toBe(true);
  });
});

describe("pushBackup", () => {
  beforeEach(async () => {
    await drive.connect(); // ensure we hold a token
  });

  it("CREATEs the file (POST) when none exists yet", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method || "GET", opts });
      // 1st: search by name -> no files. 2nd: multipart create -> returns id.
      if (url.includes("/drive/v3/files?q=")) {
        return jsonResponse({ files: [] });
      }
      return jsonResponse({ id: "new-file-id" });
    });

    const ts = await drive.pushBackup([{ id: "1", exercise: "Squat", weight: 275 }]);

    const upload = calls.find((c) => c.url.includes("/upload/"));
    expect(upload.method).toBe("POST"); // create, not update
    expect(upload.opts.headers.Authorization).toBe("Bearer fake-token");
    expect(upload.opts.headers["Content-Type"]).toContain("multipart/related");
    expect(upload.opts.body).toContain("gym-tracker-backup.json"); // metadata name
    expect(upload.opts.body).toContain('"exercise":"Squat"'); // payload
    expect(typeof ts).toBe("string"); // returns updatedAt iso
    // fileId cached for next time
    expect(localStorage.getItem("gym-tracker-drive-file-id")).toBe("new-file-id");
  });

  it("UPDATEs the file (PATCH) when a fileId is cached", async () => {
    localStorage.setItem("gym-tracker-drive-file-id", "existing-id");
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method || "GET" });
      return jsonResponse({ id: "existing-id" });
    });

    await drive.pushBackup([{ id: "1", exercise: "Bench Press", weight: 185 }]);

    // No search call — cached id is trusted; single PATCH to the upload endpoint.
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/files/existing-id");
  });
});

describe("pullBackup", () => {
  beforeEach(async () => {
    await drive.connect();
  });

  it("returns null when no backup file exists", async () => {
    global.fetch = vi.fn(async () => jsonResponse({ files: [] }));
    expect(await drive.pullBackup()).toBeNull();
  });

  it("downloads and parses the backup contents", async () => {
    localStorage.setItem("gym-tracker-drive-file-id", "existing-id");
    const backup = { schema: 1, updatedAt: "2026-07-04T00:00:00Z", entries: [{ id: "1" }] };
    global.fetch = vi.fn(async (url) => {
      expect(url).toContain("alt=media");
      return jsonResponse(backup);
    });
    const result = await drive.pullBackup();
    expect(result).toEqual(backup);
  });
});

function jsonResponse(obj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => obj,
  };
}
