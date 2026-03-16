import { serve } from "bun";
import { readdir, stat, mkdir, rm, exists } from "node:fs/promises";
import { join, resolve } from "node:path";
import index from "./index.html";

// Postgres setup — only connects if DATABASE_URL is set
const hasPg = !!process.env.DATABASE_URL;
const sql = hasPg ? Bun.sql : null;

// Redis setup — only connects if REDIS_URL is set
const hasRedis = !!process.env.REDIS_URL;
let redisClient: any = null;

// Simple Redis client using TCP socket
async function createRedisClient(url: string) {
  const parsedUrl = new URL(url);
  const host = parsedUrl.hostname;
  const port = parseInt(parsedUrl.port || "6379");
  const password = parsedUrl.password || null;
  
  return {
    host,
    port,
    password,
    async connect() {
      const socket = await Bun.connect({
        hostname: host,
        port: port,
        socket: {
          data(socket, data) {},
          open(socket) {},
          close(socket) {},
          drain(socket) {},
          error(socket, error) {},
        },
      });
      return socket;
    },
    async sendCommand(command: string[]): Promise<any> {
      const socket = await this.connect();
      
      // Build RESP protocol message
      let resp = `*${command.length}\r\n`;
      for (const arg of command) {
        resp += `$${arg.length}\r\n${arg}\r\n`;
      }
      
      return new Promise((resolve, reject) => {
        let buffer = "";
        
        socket.data = (sock, data) => {
          buffer += new TextDecoder().decode(data);
          
          // Simple RESP parser for basic responses
          if (buffer.includes("\r\n")) {
            const lines = buffer.split("\r\n");
            const firstChar = lines[0][0];
            
            if (firstChar === "+") {
              // Simple string
              resolve(lines[0].substring(1));
              sock.end();
            } else if (firstChar === "-") {
              // Error
              reject(new Error(lines[0].substring(1)));
              sock.end();
            } else if (firstChar === ":") {
              // Integer
              resolve(parseInt(lines[0].substring(1)));
              sock.end();
            } else if (firstChar === "$") {
              // Bulk string
              const len = parseInt(lines[0].substring(1));
              if (len === -1) {
                resolve(null);
                sock.end();
              } else if (lines[1]) {
                resolve(lines[1]);
                sock.end();
              }
            } else if (firstChar === "*") {
              // Array - simplified parsing
              const count = parseInt(lines[0].substring(1));
              if (count === -1) {
                resolve(null);
                sock.end();
              } else {
                const result: any[] = [];
                let idx = 1;
                for (let i = 0; i < count; i++) {
                  if (lines[idx] && lines[idx][0] === "$") {
                    const len = parseInt(lines[idx].substring(1));
                    if (len >= 0 && lines[idx + 1]) {
                      result.push(lines[idx + 1]);
                      idx += 2;
                    } else {
                      result.push(null);
                      idx += 1;
                    }
                  } else {
                    idx++;
                  }
                }
                resolve(result);
                sock.end();
              }
            }
          }
        };
        
        socket.write(resp);
        
        setTimeout(() => {
          socket.end();
          reject(new Error("Redis command timeout"));
        }, 5000);
      });
    },
    async ping() {
      return await this.sendCommand(["PING"]);
    },
    async info(section?: string) {
      if (section) {
        return await this.sendCommand(["INFO", section]);
      }
      return await this.sendCommand(["INFO"]);
    },
    async dbsize() {
      return await this.sendCommand(["DBSIZE"]);
    },
    async get(key: string) {
      return await this.sendCommand(["GET", key]);
    },
    async keys(pattern: string) {
      return await this.sendCommand(["KEYS", pattern]);
    },
  };
}

if (hasRedis) {
  try {
    redisClient = await createRedisClient(process.env.REDIS_URL!);
  } catch (e) {
    console.error("Failed to create Redis client:", e);
  }
}

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

    "/api/redis/status": {
      async GET() {
        if (!redisClient) {
          return Response.json({ connected: false, error: "REDIS_URL not configured" });
        }
        try {
          const pingResult = await redisClient.ping();
          const info = await redisClient.info("server");
          const dbsize = await redisClient.dbsize();
          
          // Parse info string for version and other details
          const infoLines = info.split("\r\n");
          let version = "Unknown";
          let mode = "standalone";
          let uptime = 0;
          
          for (const line of infoLines) {
            if (line.startsWith("redis_version:")) {
              version = line.split(":")[1];
            } else if (line.startsWith("redis_mode:")) {
              mode = line.split(":")[1];
            } else if (line.startsWith("uptime_in_seconds:")) {
              uptime = parseInt(line.split(":")[1]);
            }
          }
          
          return Response.json({
            connected: true,
            version,
            mode,
            uptime,
            dbsize,
            host: redisClient.host,
            port: redisClient.port,
          });
        } catch (e: any) {
          return Response.json({ connected: false, error: e.message });
        }
      },
    },

    "/api/redis/info": {
      async GET(req) {
        if (!redisClient) {
          return Response.json({ error: "REDIS_URL not configured" }, { status: 503 });
        }
        const url = new URL(req.url);
        const section = url.searchParams.get("section") || undefined;
        try {
          const info = await redisClient.info(section);
          return Response.json({ info });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },

    "/api/redis/command": {
      async POST(req) {
        if (!redisClient) {
          return Response.json({ error: "REDIS_URL not configured" }, { status: 503 });
        }
        const body = await req.json();
        const command = body.command;
        if (!command || !Array.isArray(command) || command.length === 0) {
          return Response.json({ error: "command array is required" }, { status: 400 });
        }
        try {
          const start = performance.now();
          const result = await redisClient.sendCommand(command);
          const duration = Math.round(performance.now() - start);
          return Response.json({
            result,
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
