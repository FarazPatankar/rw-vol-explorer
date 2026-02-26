import { serve } from "bun";
import { readdir, stat, mkdir, rm, exists } from "node:fs/promises";
import { join, resolve } from "node:path";
import index from "./index.html";

// Postgres setup — only connects if DATABASE_URL is set
const hasPg = !!process.env.DATABASE_URL;
const sql = hasPg ? Bun.sql : null;

const VOLUME_ROOT = resolve(process.env.VOLUME_PATH || (process.env.NODE_ENV === "production" ? "/data" : "./data"));

function safePath(requestedPath: string): string {
  // Strip leading slashes so resolve doesn't treat it as absolute
  const cleaned = requestedPath.replace(/^\/+/, "");
  const resolved = resolve(VOLUME_ROOT, cleaned);
  if (!resolved.startsWith(VOLUME_ROOT)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

const server = serve({
  routes: {
    "/api/files": {
      async GET(req) {
        const url = new URL(req.url);
        const dirPath = url.searchParams.get("path") || "/";
        try {
          const fullPath = safePath(dirPath);
          if (!(await exists(fullPath))) {
            return Response.json({ error: "Path not found" }, { status: 404 });
          }
          const entries = await readdir(fullPath, { withFileTypes: true });
          const items = await Promise.all(
            entries.map(async (entry) => {
              const entryPath = join(fullPath, entry.name);
              try {
                const stats = await stat(entryPath);
                return {
                  name: entry.name,
                  isDirectory: entry.isDirectory(),
                  size: stats.size,
                  modified: stats.mtime.toISOString(),
                };
              } catch {
                return {
                  name: entry.name,
                  isDirectory: entry.isDirectory(),
                  size: 0,
                  modified: new Date().toISOString(),
                };
              }
            })
          );
          items.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          return Response.json({ path: dirPath, items });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },

      async POST(req) {
        const body = await req.json();
        const { path: filePath, type, content } = body;
        try {
          const fullPath = safePath(filePath);
          if (type === "directory") {
            await mkdir(fullPath, { recursive: true });
          } else {
            const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
            await mkdir(dir, { recursive: true });
            await Bun.write(fullPath, content || "");
          }
          return Response.json({ ok: true });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },

      async DELETE(req) {
        const url = new URL(req.url);
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }
        try {
          const fullPath = safePath(filePath);
          await rm(fullPath, { recursive: true });
          return Response.json({ ok: true });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },
    },

    "/api/files/download": {
      async GET(req) {
        const url = new URL(req.url);
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }
        try {
          const fullPath = safePath(filePath);
          const file = Bun.file(fullPath);
          if (!(await file.exists())) {
            return Response.json({ error: "File not found" }, { status: 404 });
          }
          const name = fullPath.split("/").pop() || "file";
          return new Response(file, {
            headers: {
              "Content-Disposition": `attachment; filename="${name}"`,
            },
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },
    },

    "/api/files/upload": {
      async POST(req) {
        const formData = await req.formData();
        const dirPath = formData.get("path") as string || "/";
        const file = formData.get("file") as File;
        if (!file) {
          return Response.json({ error: "No file provided" }, { status: 400 });
        }
        try {
          const fullPath = safePath(join(dirPath, file.name));
          await Bun.write(fullPath, file);
          return Response.json({ ok: true });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },
    },

    "/api/files/content": {
      async GET(req) {
        const url = new URL(req.url);
        const filePath = url.searchParams.get("path");
        if (!filePath) {
          return Response.json({ error: "path required" }, { status: 400 });
        }
        try {
          const fullPath = safePath(filePath);
          const file = Bun.file(fullPath);
          if (!(await file.exists())) {
            return Response.json({ error: "File not found" }, { status: 404 });
          }
          const stats = await stat(fullPath);
          if (stats.size > 1024 * 1024) {
            return Response.json({ error: "File too large to preview", size: stats.size }, { status: 413 });
          }
          const text = await file.text();
          return Response.json({ content: text, size: stats.size });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },
    },

    "/api/pg/status": {
      async GET() {
        if (!sql) {
          return Response.json({ connected: false, error: "DATABASE_URL not configured" });
        }
        try {
          const [row] = await sql`SELECT version(), current_database(), current_user`;
          return Response.json({
            connected: true,
            version: row.version,
            database: row.current_database,
            user: row.current_user,
          });
        } catch (e: any) {
          return Response.json({ connected: false, error: e.message });
        }
      },
    },

    "/api/pg/tables": {
      async GET() {
        if (!sql) {
          return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
        }
        try {
          const tables = await sql`
            SELECT t.tablename AS name,
                   COALESCE(s.n_live_tup, 0) AS row_count
            FROM pg_catalog.pg_tables t
            LEFT JOIN pg_stat_user_tables s
              ON s.relname = t.tablename AND s.schemaname = t.schemaname
            WHERE t.schemaname = 'public'
            ORDER BY t.tablename
          `;
          return Response.json({ tables });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },

    "/api/pg/query": {
      async POST(req) {
        if (!sql) {
          return Response.json({ error: "DATABASE_URL not configured" }, { status: 503 });
        }
        const body = await req.json();
        const query = body.query?.trim();
        if (!query) {
          return Response.json({ error: "query is required" }, { status: 400 });
        }
        try {
          const start = performance.now();
          const rows = await sql.unsafe(query);
          const duration = Math.round(performance.now() - start);
          const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
          return Response.json({
            columns,
            rows,
            rowCount: rows.length,
            duration,
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 400 });
        }
      },
    },

    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

// Ensure /data exists before serving
await mkdir(VOLUME_ROOT, { recursive: true });

console.log(`Server running at ${server.url}`);
