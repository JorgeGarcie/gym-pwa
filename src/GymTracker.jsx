import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Plus, Trash2, TrendingUp, Dumbbell, Calendar, X, Cloud, CloudOff, Download, RefreshCw } from "lucide-react";
import { getAllEntries, putEntries, deleteEntry as dbDeleteEntry, clearEntries } from "./db";
import * as drive from "./drive";

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};

const timeAgo = (iso) => {
  if (!iso) return "never";
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
};

export default function GymTracker() {
  const [entries, setEntries] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [exercise, setExercise] = useState("");
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [sets, setSets] = useState("1");
  const [selectedExercise, setSelectedExercise] = useState(null);
  const [error, setError] = useState("");

  // Drive sync state
  const [connected, setConnected] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | error
  const [lastSynced, setLastSynced] = useState(null);
  const [, forceTick] = useState(0); // re-render to refresh "X ago" label
  const syncTimer = useRef(null);

  // --- Load from IndexedDB on mount (replaces window.storage.get) ---
  useEffect(() => {
    (async () => {
      try {
        const all = await getAllEntries();
        setEntries(all);
      } catch (e) {
        console.error("load failed", e);
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Refresh the "last synced" relative label once a minute.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 60000);
    return () => clearInterval(id);
  }, []);

  // --- Drive push (debounced) ---
  const pushToDrive = useCallback(async (data) => {
    if (!drive.isConnected()) return;
    if (!navigator.onLine) return; // offline: skip, will retry on next log
    setSyncStatus("syncing");
    try {
      const ts = await drive.pushBackup(data);
      setLastSynced(ts);
      setSyncStatus("idle");
    } catch (e) {
      console.error("drive push failed", e);
      setSyncStatus("error");
    }
  }, []);

  const scheduleSync = useCallback(
    (data) => {
      if (!drive.isConnected()) return;
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => pushToDrive(data), 30000); // 30s debounce
    },
    [pushToDrive]
  );

  // Flush any pending sync when the app is backgrounded/closed.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden" && drive.isConnected()) {
        clearTimeout(syncTimer.current);
        pushToDrive(entries);
      }
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, [entries, pushToDrive]);

  // Persist to IndexedDB whenever entries change, then schedule a Drive sync.
  // We replace the whole store (simple + safe for this data size).
  const persist = useCallback(
    async (next) => {
      await clearEntries();
      await putEntries(next);
      scheduleSync(next);
    },
    [scheduleSync]
  );

  const exerciseNames = useMemo(() => {
    const set = new Set(entries.map((e) => e.exercise));
    return Array.from(set).sort();
  }, [entries]);

  const todayEntries = useMemo(
    () => entries.filter((e) => e.date === todayStr()).sort((a, b) => b.ts - a.ts),
    [entries]
  );

  const groupedByDate = useMemo(() => {
    const groups = {};
    entries.forEach((e) => {
      groups[e.date] = groups[e.date] || [];
      groups[e.date].push(e);
    });
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  const prs = useMemo(() => {
    const best = {};
    entries.forEach((e) => {
      if (!best[e.exercise] || e.weight > best[e.exercise].weight) {
        best[e.exercise] = e;
      }
    });
    return best;
  }, [entries]);

  const chartData = useMemo(() => {
    if (!selectedExercise) return [];
    return entries
      .filter((e) => e.exercise === selectedExercise)
      .sort((a, b) => a.ts - b.ts)
      .map((e) => ({ date: fmtDate(e.date), weight: e.weight, label: `${e.weight}×${e.reps}` }));
  }, [entries, selectedExercise]);

  const addEntry = () => {
    const w = parseFloat(weight);
    const r = parseInt(reps, 10);
    const s = parseInt(sets, 10) || 1;
    if (!exercise.trim()) {
      setError("Name the exercise");
      return;
    }
    if (isNaN(w) || isNaN(r)) {
      setError("Enter weight and reps");
      return;
    }
    setError("");
    const newEntries = [];
    for (let i = 0; i < s; i++) {
      newEntries.push({
        id: `${Date.now()}-${i}`,
        ts: Date.now() + i,
        date: todayStr(),
        exercise: exercise.trim(),
        weight: w,
        reps: r,
      });
    }
    const next = [...entries, ...newEntries];
    setEntries(next);
    persist(next);
    setWeight("");
    setReps("");
    setSets("1");
  };

  const deleteEntry = (id) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    dbDeleteEntry(id);
    scheduleSync(next);
  };

  // --- Drive connect / manual sync / restore ---
  const handleConnect = async () => {
    try {
      await drive.connect();
      setConnected(true);
      // On connect, pull remote and merge (last-write-wins by id, union).
      const remote = await drive.pullBackup();
      if (remote?.entries?.length) {
        const byId = new Map(entries.map((e) => [e.id, e]));
        remote.entries.forEach((e) => byId.set(e.id, e));
        const merged = Array.from(byId.values());
        setEntries(merged);
        await persist(merged);
        setLastSynced(remote.updatedAt);
      } else {
        await pushToDrive(entries); // seed the backup
      }
    } catch (e) {
      console.error(e);
      setError(e.message);
    }
  };

  const handleManualSync = async () => {
    if (!connected) return handleConnect();
    clearTimeout(syncTimer.current);
    await pushToDrive(entries);
  };

  const handleDisconnect = () => {
    drive.disconnect();
    setConnected(false);
    setSyncStatus("idle");
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gym-tracker-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const driveConfigured = drive.isConfigured();

  return (
    <div style={{ background: "#14171A", minHeight: "100vh", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        input::placeholder { color: #5B6169; }
        input:focus { outline: none; border-color: #E8590C !important; }
        .mono { font-family: 'JetBrains Mono', monospace; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "20px 16px 40px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ color: "#5B6169", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 }}>
              Training Log
            </div>
            <div style={{ color: "#ECEAE4", fontSize: 28, fontWeight: 900, letterSpacing: -0.5 }}>
              {fmtDate(todayStr())}
            </div>
          </div>
          <Dumbbell color="#E8590C" size={26} />
        </div>

        {/* Sync bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16, background: "#1E2226", border: "1px solid #2C3136", borderRadius: 10, padding: "8px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            {connected ? <Cloud size={16} color="#4C9A8B" /> : <CloudOff size={16} color="#5B6169" />}
            <span style={{ color: "#8B9198", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {!driveConfigured
                ? "Drive not configured"
                : !connected
                ? "Not backed up"
                : syncStatus === "error"
                ? "Sync error"
                : `Synced ${timeAgo(lastSynced)}`}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={handleExport} title="Export JSON" style={iconBtn}>
              <Download size={15} color="#8B9198" />
            </button>
            {driveConfigured && connected && (
              <button onClick={handleManualSync} title="Sync now" style={iconBtn}>
                <RefreshCw size={15} color="#8B9198" className={syncStatus === "syncing" ? "spin" : ""} />
              </button>
            )}
            {driveConfigured &&
              (connected ? (
                <button onClick={handleDisconnect} style={connectBtn}>Disconnect</button>
              ) : (
                <button onClick={handleConnect} style={connectBtn}>Connect Drive</button>
              ))}
          </div>
        </div>

        {/* Quick add card */}
        <div style={{ background: "#1E2226", border: "1px solid #2C3136", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <input
            value={exercise}
            onChange={(e) => setExercise(e.target.value)}
            placeholder="Exercise (e.g. Bench Press)"
            list="exercise-list"
            style={{
              width: "100%",
              background: "#14171A",
              border: "1px solid #2C3136",
              borderRadius: 8,
              padding: "10px 12px",
              color: "#ECEAE4",
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 10,
            }}
          />
          <datalist id="exercise-list">
            {exerciseNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
            {[
              ["Weight", weight, setWeight, "lbs"],
              ["Reps", reps, setReps, "reps"],
              ["Sets", sets, setSets, "sets"],
            ].map(([label, val, setter, ph]) => (
              <div key={label}>
                <div style={{ color: "#5B6169", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
                  {label}
                </div>
                <input
                  value={val}
                  onChange={(e) => setter(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder={ph}
                  inputMode="decimal"
                  className="mono"
                  style={{
                    width: "100%",
                    background: "#14171A",
                    border: "1px solid #2C3136",
                    borderRadius: 8,
                    padding: "10px 8px",
                    color: "#ECEAE4",
                    fontSize: 16,
                    fontWeight: 700,
                    textAlign: "center",
                  }}
                />
              </div>
            ))}
          </div>

          {error && <div style={{ color: "#E8590C", fontSize: 12, marginBottom: 8 }}>{error}</div>}

          <button
            onClick={addEntry}
            style={{
              width: "100%",
              background: "#E8590C",
              border: "none",
              borderRadius: 8,
              padding: "12px",
              color: "#14171A",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <Plus size={18} strokeWidth={3} /> LOG SET
          </button>
        </div>

        {/* Today's session */}
        {todayEntries.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#5B6169", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
              Today's Session
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {todayEntries.map((e) => {
                const isPR = prs[e.exercise]?.id === e.id;
                return (
                  <div
                    key={e.id}
                    style={{
                      background: "#1E2226",
                      border: `1px solid ${isPR ? "#E8590C55" : "#2C3136"}`,
                      borderRadius: 8,
                      padding: "10px 12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: "#ECEAE4", fontWeight: 700, fontSize: 14 }}>{e.exercise}</span>
                      {isPR && (
                        <span style={{ background: "#E8590C", color: "#14171A", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4, letterSpacing: 0.5 }}>
                          PR
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="mono" style={{ color: "#4C9A8B", fontSize: 14, fontWeight: 700 }}>
                        {e.weight}×{e.reps}
                      </span>
                      <button onClick={() => deleteEntry(e.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2 }}>
                        <Trash2 size={14} color="#5B6169" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PR shelf */}
        {Object.keys(prs).length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#5B6169", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>
              Personal Records
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {Object.entries(prs)
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([name, e]) => (
                  <button
                    key={name}
                    onClick={() => setSelectedExercise(name)}
                    style={{
                      background: "#1E2226",
                      border: selectedExercise === name ? "1px solid #4C9A8B" : "1px solid #2C3136",
                      borderRadius: 10,
                      padding: "10px 12px",
                      textAlign: "left",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ color: "#8B9198", fontSize: 11, fontWeight: 600, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                    <div className="mono" style={{ color: "#ECEAE4", fontSize: 20, fontWeight: 900 }}>
                      {e.weight}<span style={{ fontSize: 12, color: "#5B6169" }}> ×{e.reps}</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Chart for selected exercise */}
        {selectedExercise && chartData.length > 0 && (
          <div style={{ background: "#1E2226", border: "1px solid #2C3136", borderRadius: 12, padding: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <TrendingUp size={14} color="#4C9A8B" />
                <span style={{ color: "#ECEAE4", fontSize: 13, fontWeight: 700 }}>{selectedExercise}</span>
              </div>
              <button onClick={() => setSelectedExercise(null)} style={{ background: "none", border: "none", cursor: "pointer" }}>
                <X size={16} color="#5B6169" />
              </button>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" stroke="#5B6169" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis stroke="#5B6169" fontSize={10} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "#14171A", border: "1px solid #2C3136", borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: "#8B9198" }}
                  itemStyle={{ color: "#4C9A8B" }}
                />
                <Line type="monotone" dataKey="weight" stroke="#4C9A8B" strokeWidth={2} dot={{ fill: "#4C9A8B", r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Full history */}
        {groupedByDate.length > 0 && (
          <div>
            <div style={{ color: "#5B6169", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={12} /> History
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {groupedByDate.map(([date, list]) => (
                <div key={date}>
                  <div style={{ color: "#8B9198", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{fmtDate(date)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {list
                      .sort((a, b) => a.ts - b.ts)
                      .map((e) => (
                        <div
                          key={e.id}
                          onClick={() => setSelectedExercise(e.exercise)}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            padding: "6px 10px",
                            background: "#1A1D21",
                            borderRadius: 6,
                            cursor: "pointer",
                          }}
                        >
                          <span style={{ color: "#ECEAE4", fontSize: 13 }}>{e.exercise}</span>
                          <span className="mono" style={{ color: "#8B9198", fontSize: 13 }}>
                            {e.weight}×{e.reps}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {loaded && entries.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#5B6169" }}>
            <Dumbbell size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
            <div style={{ fontSize: 14 }}>No sets logged yet. Add your first one above.</div>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtn = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
};

const connectBtn = {
  background: "#2C3136",
  border: "none",
  borderRadius: 6,
  padding: "6px 10px",
  color: "#ECEAE4",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap",
};
