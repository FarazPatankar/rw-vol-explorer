import "./index.css";
import { useState, useEffect, useCallback, useRef } from "react";

interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
  modified: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

interface PgStatus {
  connected: boolean;
  version?: string;
  database?: string;
  user?: string;
  error?: string;
}

interface PgTable {
  name: string;
  row_count: number;
}

interface QueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  duration: number;
}

function PostgresExplorer() {
  const [status, setStatus] = useState<PgStatus | null>(null);
  const [tables, setTables] = useState<PgTable[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pg/status");
      setStatus(await res.json());
    } catch {
      setStatus({ connected: false, error: "Failed to reach server" });
    }
  }, []);

  const fetchTables = useCallback(async () => {
    try {
      const res = await fetch("/api/pg/tables");
      const data = await res.json();
      if (data.tables) setTables(data.tables);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.connected) fetchTables();
  }, [status?.connected, fetchTables]);

  const runQuery = async (sql: string) => {
    setRunning(true);
    setQueryError(null);
    setResult(null);
    try {
      const res = await fetch("/api/pg/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
      const data = await res.json();
      if (data.error) {
        setQueryError(data.error);
      } else {
        setResult(data);
      }
    } catch (e: any) {
      setQueryError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = () => {
    if (query.trim()) runQuery(query);
  };

  const handleTableClick = (tableName: string) => {
    const sql = `SELECT * FROM "${tableName}" LIMIT 100`;
    setQuery(sql);
    runQuery(sql);
  };

  if (status && !status.connected) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Postgres Explorer</h1>
        <div className="p-4 bg-zinc-800 rounded-lg border border-zinc-700 text-zinc-400 text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span className="font-medium text-zinc-300">Not Connected</span>
          </div>
          <p>{status.error || "DATABASE_URL is not configured."}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Postgres Explorer</h1>

      {/* Connection status */}
      {status && (
        <div className="mb-4 p-3 bg-zinc-800 rounded-lg border border-zinc-700 text-sm flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block flex-shrink-0" />
          <div className="text-zinc-300 min-w-0">
            <span className="font-medium text-white">{status.database}</span>
            <span className="text-zinc-500 mx-1.5">|</span>
            <span>{status.user}</span>
            <span className="text-zinc-500 mx-1.5">|</span>
            <span className="text-zinc-400 truncate">{status.version?.split(",")[0]}</span>
          </div>
        </div>
      )}

      {/* Tables list */}
      {tables.length > 0 && (
        <div className="mb-4">
          <h3 className="text-sm font-medium text-zinc-400 mb-2">Tables</h3>
          <div className="flex flex-wrap gap-2">
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => handleTableClick(t.name)}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm transition-colors"
              >
                {t.name}
                <span className="text-zinc-500 ml-1.5">({t.row_count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick queries */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-zinc-400 mb-2">Quick Queries</h3>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Test Connection", sql: "SELECT 1 AS ok" },
            { label: "Trigger Error", sql: "SELECT * FROM this_table_does_not_exist" },
            { label: "List Tables", sql: "SELECT tablename FROM pg_tables WHERE schemaname = 'public'" },
          ].map((q) => (
            <button
              key={q.label}
              onClick={() => { setQuery(q.sql); runQuery(q.sql); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-sm transition-colors"
            >
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {/* Query editor */}
      <div className="mb-4">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="SELECT * FROM ..."
          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm font-mono outline-none focus:border-blue-500 h-28 resize-y"
        />
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleSubmit}
            disabled={running || !query.trim()}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 rounded text-sm transition-colors"
          >
            {running ? "Running..." : "Run Query"}
          </button>
          <span className="text-xs text-zinc-500">Cmd+Enter to run</span>
        </div>
      </div>

      {/* Query error */}
      {queryError && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm font-mono whitespace-pre-wrap">
          {queryError}
        </div>
      )}

      {/* Results table */}
      {result && (
        <div>
          <div className="text-xs text-zinc-500 mb-2">
            {result.rowCount} row{result.rowCount !== 1 ? "s" : ""} in {result.duration}ms
          </div>
          {result.columns.length > 0 ? (
            <div className="border border-zinc-800 rounded-lg overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-800/50 text-zinc-400 text-left sticky top-0">
                    {result.columns.map((col) => (
                      <th key={col} className="px-4 py-2 font-medium whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-t border-zinc-800 hover:bg-zinc-800/30">
                      {result.columns.map((col) => (
                        <td key={col} className="px-4 py-2 text-zinc-300 whitespace-nowrap max-w-xs truncate">
                          {row[col] === null ? (
                            <span className="text-zinc-600 italic">null</span>
                          ) : (
                            String(row[col])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">Query executed successfully (no rows returned).</div>
          )}
        </div>
      )}
    </div>
  );
}

export function App() {
  const [currentPath, setCurrentPath] = useState("/");
  const [items, setItems] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState<"file" | "directory" | null>(null);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setItems(data.items);
      setCurrentPath(path);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles("/");
  }, [fetchFiles]);

  const navigate = (name: string) => {
    const next = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    fetchFiles(next);
  };

  const navigateTo = (path: string) => {
    fetchFiles(path);
  };

  const breadcrumbs = () => {
    if (currentPath === "/") return [{ name: "data", path: "/" }];
    const parts = currentPath.split("/").filter(Boolean);
    return [
      { name: "data", path: "/" },
      ...parts.map((p, i) => ({
        name: p,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const filePath =
      currentPath === "/"
        ? `/${newName}`
        : `${currentPath}/${newName}`;
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          type: showNewDialog,
          content: showNewDialog === "file" ? newContent : undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setShowNewDialog(null);
      setNewName("");
      setNewContent("");
      fetchFiles(currentPath);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleDelete = async (name: string) => {
    const filePath =
      currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    try {
      const res = await fetch(
        `/api/files?path=${encodeURIComponent(filePath)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDeleteConfirm(null);
      fetchFiles(currentPath);
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("path", currentPath);
    formData.append("file", file);
    try {
      const res = await fetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      fetchFiles(currentPath);
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    }
    e.target.value = "";
  };

  const handlePreview = async (name: string) => {
    const filePath =
      currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    try {
      const res = await fetch(
        `/api/files/content?path=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();
      if (data.error) {
        alert(data.error);
        return;
      }
      setPreview({ name, content: data.content });
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDownload = (name: string) => {
    const filePath =
      currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
    window.open(
      `/api/files/download?path=${encodeURIComponent(filePath)}`,
      "_blank"
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Volume Explorer</h1>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm text-zinc-400">
        {breadcrumbs().map((crumb, i) => (
          <span key={crumb.path} className="flex items-center gap-1">
            {i > 0 && <span className="text-zinc-600">/</span>}
            <button
              onClick={() => navigateTo(crumb.path)}
              className="hover:text-white transition-colors"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => {
            setShowNewDialog("file");
            setNewName("");
            setNewContent("");
          }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
        >
          + File
        </button>
        <button
          onClick={() => {
            setShowNewDialog("directory");
            setNewName("");
          }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
        >
          + Folder
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
        >
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleUpload}
          className="hidden"
        />
        <button
          onClick={() => fetchFiles(currentPath)}
          className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors ml-auto"
        >
          Refresh
        </button>
      </div>

      {/* New file/folder dialog */}
      {showNewDialog && (
        <div className="mb-4 p-4 bg-zinc-800 rounded-lg border border-zinc-700">
          <h3 className="text-sm font-medium mb-2">
            New {showNewDialog === "file" ? "File" : "Folder"}
          </h3>
          <input
            type="text"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-600 rounded text-sm mb-2 outline-none focus:border-blue-500"
            autoFocus
          />
          {showNewDialog === "file" && (
            <textarea
              placeholder="Content (optional)"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-600 rounded text-sm mb-2 outline-none focus:border-blue-500 h-24 resize-y font-mono"
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => setShowNewDialog(null)}
              className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* File list */}
      {loading ? (
        <div className="text-zinc-500 text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <div className="text-zinc-500 text-sm py-8 text-center">
          Empty directory
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-800/50 text-zinc-400 text-left">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium w-24">Size</th>
                <th className="px-4 py-2 font-medium w-44">Modified</th>
                <th className="px-4 py-2 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.name}
                  className="border-t border-zinc-800 hover:bg-zinc-800/30 transition-colors"
                >
                  <td className="px-4 py-2">
                    {item.isDirectory ? (
                      <button
                        onClick={() => navigate(item.name)}
                        className="flex items-center gap-2 hover:text-blue-400 transition-colors"
                      >
                        <span className="text-yellow-500">&#128193;</span>
                        {item.name}
                      </button>
                    ) : (
                      <button
                        onClick={() => handlePreview(item.name)}
                        className="flex items-center gap-2 hover:text-blue-400 transition-colors"
                      >
                        <span className="text-zinc-400">&#128196;</span>
                        {item.name}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">
                    {item.isDirectory ? "-" : formatSize(item.size)}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">
                    {formatDate(item.modified)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1 justify-end">
                      {!item.isDirectory && (
                        <button
                          onClick={() => handleDownload(item.name)}
                          className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                          title="Download"
                        >
                          DL
                        </button>
                      )}
                      {deleteConfirm === item.name ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleDelete(item.name)}
                            className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 rounded transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(item.name)}
                          className="px-2 py-1 text-xs bg-zinc-700 hover:bg-red-600 rounded transition-colors"
                          title="Delete"
                        >
                          Del
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Postgres Explorer */}
      <div className="mt-10 pt-8 border-t border-zinc-800">
        <PostgresExplorer />
      </div>

      {/* Preview modal */}
      {preview && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-3xl w-full max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
              <h3 className="font-medium text-sm">{preview.name}</h3>
              <button
                onClick={() => setPreview(null)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                &times;
              </button>
            </div>
            <pre className="p-4 overflow-auto text-sm font-mono text-zinc-300 whitespace-pre-wrap">
              {preview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
