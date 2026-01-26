/**
 * DO Registry - Location-aware Durable Object name resolution
 *
 * Maintains a name→ID mapping with colo tracking, stored in DO SQLite
 * and cached to R2 for scalable reads.
 *
 * Architecture:
 * - RegistryDO: Authoritative source (SQLite), handles writes
 * - R2 snapshots: Cached JSON blobs for scalable reads
 * - Worker cache: In-memory for hot paths
 */

import { RpcTarget } from 'capnweb'

/**
 * Registry entry for a named Durable Object
 */
export interface RegistryEntry {
  /** Logical name (user-provided) */
  name: string
  /** Namespace (DO class name, e.g., 'POSTGRES_DO') */
  namespace: string
  /** Actual DO ID (hex string) */
  id: string
  /** Colo where the DO was created */
  colo: string
  /** Creation timestamp */
  createdAt: number
  /** Last accessed timestamp */
  accessedAt: number
  /** Migration history (if moved between colos) */
  migrations?: Array<{
    fromColo: string
    toColo: string
    fromId: string
    toId: string
    migratedAt: number
  }>
  /** Custom metadata */
  metadata?: Record<string, unknown>
}

/**
 * Options for creating a new DO
 */
export interface CreateOptions {
  /** Target colo (IATA code) */
  in: string
  /** Custom metadata to store */
  metadata?: Record<string, unknown>
}

/**
 * Options for getting an existing DO
 */
export interface GetOptions {
  /** Preferred colo (soft hint, returns existing if in different colo) */
  prefer?: string
  /** Required colo (throws if DO exists in different colo) */
  in?: string
}

/**
 * Result of a registry lookup
 */
export interface LookupResult {
  /** The registry entry */
  entry: RegistryEntry
  /** Whether this came from cache or DO */
  cached: boolean
  /** Cache age in milliseconds (if cached) */
  cacheAge?: number
}

/**
 * Registry snapshot stored in R2
 */
export interface RegistrySnapshot {
  /** Namespace this snapshot covers */
  namespace: string
  /** Snapshot timestamp */
  timestamp: number
  /** Version number (incremented on each write) */
  version: number
  /** All entries in this namespace */
  entries: RegistryEntry[]
  /** Entry count */
  count: number
}

// ============================================================================
// RegistryDO - Durable Object for registry storage
// ============================================================================

/**
 * SQL schema for registry storage
 */
const REGISTRY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    name TEXT NOT NULL,
    namespace TEXT NOT NULL,
    id TEXT NOT NULL,
    colo TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accessed_at INTEGER NOT NULL,
    metadata TEXT,
    PRIMARY KEY (namespace, name)
  );

  CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    name TEXT NOT NULL,
    from_colo TEXT NOT NULL,
    to_colo TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    migrated_at INTEGER NOT NULL,
    FOREIGN KEY (namespace, name) REFERENCES entries(namespace, name)
  );

  CREATE TABLE IF NOT EXISTS snapshots (
    namespace TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 0,
    last_snapshot_at INTEGER,
    r2_key TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entries_colo ON entries(colo);
  CREATE INDEX IF NOT EXISTS idx_entries_accessed ON entries(accessed_at);
`

/**
 * RegistryDO - Manages DO name→ID mappings
 *
 * Uses SQLite for durable storage, flushes snapshots to R2 for caching.
 */
export class RegistryDO extends RpcTarget implements DurableObject {
  private state: DurableObjectState
  private env: RegistryEnv
  private initialized = false
  private _colo: string | null = null
  private pendingFlush = false
  private flushDebounceMs = 1000

  constructor(state: DurableObjectState, env: RegistryEnv) {
    super()
    this.state = state
    this.env = env
  }

  private async init(): Promise<void> {
    if (this.initialized) return

    // Initialize schema
    this.state.storage.sql.exec(REGISTRY_SCHEMA)
    this.initialized = true
  }

  /**
   * Detect colo from request
   */
  private detectColo(request?: Request): void {
    if (this._colo) return
    if (!request) return

    const cf = (request as unknown as { cf?: IncomingRequestCfProperties }).cf
    this._colo = cf?.colo ?? null
  }

  // ==========================================================================
  // RPC Methods (exposed via capnweb)
  // ==========================================================================

  /**
   * Create a new named DO entry
   *
   * @param namespace - DO class name (e.g., 'POSTGRES_DO')
   * @param name - Logical name for this instance
   * @param options - Creation options including target colo
   * @returns The created entry
   */
  async create(
    namespace: string,
    name: string,
    options: CreateOptions
  ): Promise<RegistryEntry> {
    await this.init()

    // Check if name already exists
    const existing = this.state.storage.sql
      .exec<{ name: string }>(`SELECT name FROM entries WHERE namespace = ? AND name = ?`, namespace, name)
      .one()

    if (existing) {
      throw new Error(`Entry '${name}' already exists in namespace '${namespace}'`)
    }

    // Generate a unique ID that encodes the target colo
    // Format: colo:name:random to influence placement
    const coloHint = options.in.toUpperCase()
    const randomPart = crypto.randomUUID().slice(0, 8)
    const doName = `${coloHint}:${name}:${randomPart}`

    // We store the doName which will be used with idFromName()
    // The actual hex ID is computed by the namespace
    const now = Date.now()

    this.state.storage.sql.exec(
      `INSERT INTO entries (namespace, name, id, colo, created_at, accessed_at, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      namespace,
      name,
      doName,  // This is the name used for idFromName()
      coloHint,
      now,
      now,
      options.metadata ? JSON.stringify(options.metadata) : null
    )

    // Increment version for this namespace
    this.state.storage.sql.exec(
      `INSERT INTO snapshots (namespace, version) VALUES (?, 1)
       ON CONFLICT(namespace) DO UPDATE SET version = version + 1`,
      namespace
    )

    // Schedule R2 flush
    this.scheduleFlush(namespace)

    return {
      name,
      namespace,
      id: doName,
      colo: coloHint,
      createdAt: now,
      accessedAt: now,
      metadata: options.metadata,
    }
  }

  /**
   * Get an existing entry by name
   *
   * @param namespace - DO class name
   * @param name - Logical name
   * @param options - Get options (prefer/require colo)
   * @returns The entry, or null if not found
   */
  async get(
    namespace: string,
    name: string,
    options?: GetOptions
  ): Promise<RegistryEntry | null> {
    await this.init()

    const row = this.state.storage.sql
      .exec<{
        name: string
        namespace: string
        id: string
        colo: string
        created_at: number
        accessed_at: number
        metadata: string | null
      }>(
        `SELECT * FROM entries WHERE namespace = ? AND name = ?`,
        namespace,
        name
      )
      .one()

    if (!row) return null

    // Check colo requirement
    if (options?.in && row.colo !== options.in.toUpperCase()) {
      throw new Error(
        `Entry '${name}' exists in ${row.colo}, not ${options.in.toUpperCase()}`
      )
    }

    // Update accessed timestamp
    this.state.storage.sql.exec(
      `UPDATE entries SET accessed_at = ? WHERE namespace = ? AND name = ?`,
      Date.now(),
      namespace,
      name
    )

    // Load migrations if any
    const migrations = this.state.storage.sql
      .exec<{
        from_colo: string
        to_colo: string
        from_id: string
        to_id: string
        migrated_at: number
      }>(
        `SELECT * FROM migrations WHERE namespace = ? AND name = ? ORDER BY migrated_at`,
        namespace,
        name
      )
      .toArray()

    return {
      name: row.name,
      namespace: row.namespace,
      id: row.id,
      colo: row.colo,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      migrations: migrations.length > 0
        ? migrations.map(m => ({
            fromColo: m.from_colo,
            toColo: m.to_colo,
            fromId: m.from_id,
            toId: m.to_id,
            migratedAt: m.migrated_at,
          }))
        : undefined,
    }
  }

  /**
   * Get or create an entry
   *
   * @param namespace - DO class name
   * @param name - Logical name
   * @param options - Creation options (used if creating)
   * @returns The entry (existing or newly created)
   */
  async getOrCreate(
    namespace: string,
    name: string,
    options: CreateOptions
  ): Promise<{ entry: RegistryEntry; created: boolean }> {
    const existing = await this.get(namespace, name)
    if (existing) {
      return { entry: existing, created: false }
    }
    const entry = await this.create(namespace, name, options)
    return { entry, created: true }
  }

  /**
   * List all entries in a namespace
   */
  async list(namespace: string, options?: {
    colo?: string
    limit?: number
    offset?: number
  }): Promise<RegistryEntry[]> {
    await this.init()

    let query = `SELECT * FROM entries WHERE namespace = ?`
    const params: (string | number)[] = [namespace]

    if (options?.colo) {
      query += ` AND colo = ?`
      params.push(options.colo.toUpperCase())
    }

    query += ` ORDER BY name`

    if (options?.limit) {
      query += ` LIMIT ?`
      params.push(options.limit)
    }
    if (options?.offset) {
      query += ` OFFSET ?`
      params.push(options.offset)
    }

    const rows = this.state.storage.sql
      .exec<{
        name: string
        namespace: string
        id: string
        colo: string
        created_at: number
        accessed_at: number
        metadata: string | null
      }>(query, ...params)
      .toArray()

    return rows.map(row => ({
      name: row.name,
      namespace: row.namespace,
      id: row.id,
      colo: row.colo,
      createdAt: row.created_at,
      accessedAt: row.accessed_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }))
  }

  /**
   * Delete an entry
   */
  async delete(namespace: string, name: string): Promise<boolean> {
    await this.init()

    const result = this.state.storage.sql.exec(
      `DELETE FROM entries WHERE namespace = ? AND name = ?`,
      namespace,
      name
    )

    if (result.rowsWritten > 0) {
      // Increment version
      this.state.storage.sql.exec(
        `UPDATE snapshots SET version = version + 1 WHERE namespace = ?`,
        namespace
      )
      this.scheduleFlush(namespace)
      return true
    }
    return false
  }

  /**
   * Move an entry to a different colo (creates new DO, records migration)
   */
  async move(
    namespace: string,
    name: string,
    options: { to: string }
  ): Promise<RegistryEntry> {
    await this.init()

    const entry = await this.get(namespace, name)
    if (!entry) {
      throw new Error(`Entry '${name}' not found in namespace '${namespace}'`)
    }

    const newColo = options.to.toUpperCase()
    if (entry.colo === newColo) {
      return entry // Already in target colo
    }

    // Generate new ID for the new colo
    const randomPart = crypto.randomUUID().slice(0, 8)
    const newDoName = `${newColo}:${name}:${randomPart}`
    const now = Date.now()

    // Record migration
    this.state.storage.sql.exec(
      `INSERT INTO migrations (namespace, name, from_colo, to_colo, from_id, to_id, migrated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      namespace,
      name,
      entry.colo,
      newColo,
      entry.id,
      newDoName,
      now
    )

    // Update entry
    this.state.storage.sql.exec(
      `UPDATE entries SET id = ?, colo = ?, accessed_at = ? WHERE namespace = ? AND name = ?`,
      newDoName,
      newColo,
      now,
      namespace,
      name
    )

    // Increment version
    this.state.storage.sql.exec(
      `UPDATE snapshots SET version = version + 1 WHERE namespace = ?`,
      namespace
    )

    this.scheduleFlush(namespace)

    return {
      ...entry,
      id: newDoName,
      colo: newColo,
      accessedAt: now,
      migrations: [
        ...(entry.migrations || []),
        {
          fromColo: entry.colo,
          toColo: newColo,
          fromId: entry.id,
          toId: newDoName,
          migratedAt: now,
        },
      ],
    }
  }

  // ==========================================================================
  // R2 Snapshot Management
  // ==========================================================================

  /**
   * Schedule a flush to R2 (debounced)
   */
  private scheduleFlush(namespace: string): void {
    if (this.pendingFlush) return
    this.pendingFlush = true

    // Use alarm for debounced flush
    this.state.storage.setAlarm(Date.now() + this.flushDebounceMs)
  }

  /**
   * Alarm handler - flushes pending changes to R2
   */
  async alarm(): Promise<void> {
    this.pendingFlush = false
    try {
      await this.flushAllNamespaces()
    } catch (error) {
      // Log error but don't rethrow - alarm errors can cause issues
      console.error('RegistryDO alarm error:', error instanceof Error ? error.message : String(error))
      // Re-schedule alarm to retry later
      this.state.storage.setAlarm(Date.now() + this.flushDebounceMs * 2)
    }
  }

  /**
   * Flush all namespaces with pending changes to R2
   */
  private async flushAllNamespaces(): Promise<void> {
    await this.init()

    const namespaces = this.state.storage.sql
      .exec<{ namespace: string; version: number }>(`SELECT namespace, version FROM snapshots`)
      .toArray()

    for (const ns of namespaces) {
      await this.flushNamespace(ns.namespace, ns.version)
    }
  }

  /**
   * Flush a single namespace to R2
   */
  private async flushNamespace(namespace: string, version: number): Promise<void> {
    const entries = await this.list(namespace)

    const snapshot: RegistrySnapshot = {
      namespace,
      timestamp: Date.now(),
      version,
      entries,
      count: entries.length,
    }

    const key = `registry/${namespace}/snapshot.json`

    await this.env.REGISTRY_BUCKET.put(key, JSON.stringify(snapshot, null, 2), {
      httpMetadata: {
        contentType: 'application/json',
        cacheControl: 'public, max-age=60', // Cache for 1 minute
      },
      customMetadata: {
        version: String(version),
        count: String(entries.length),
      },
    })

    // Update snapshot record
    this.state.storage.sql.exec(
      `UPDATE snapshots SET last_snapshot_at = ?, r2_key = ? WHERE namespace = ?`,
      Date.now(),
      key,
      namespace
    )
  }

  /**
   * Force flush a namespace (for manual refresh)
   */
  async forceFlush(namespace: string): Promise<{ key: string; version: number }> {
    await this.init()

    const row = this.state.storage.sql
      .exec<{ version: number }>(`SELECT version FROM snapshots WHERE namespace = ?`, namespace)
      .one()

    const version = row?.version ?? 1

    await this.flushNamespace(namespace, version)

    return {
      key: `registry/${namespace}/snapshot.json`,
      version,
    }
  }

  // ==========================================================================
  // HTTP Handler (for non-RPC access)
  // ==========================================================================

  async fetch(request: Request): Promise<Response> {
    this.detectColo(request)

    // For now, just return colo info
    return Response.json({
      colo: this._colo,
      message: 'Use capnweb RPC to interact with the registry',
    })
  }
}

// ============================================================================
// Environment Types
// ============================================================================

export interface RegistryEnv {
  REGISTRY_BUCKET: R2Bucket
  REGISTRY_DO: DurableObjectNamespace
}

// ============================================================================
// Client-side Registry Helper
// ============================================================================

/**
 * Options for the registry client
 */
export interface RegistryClientOptions {
  /** R2 bucket for cached snapshots */
  bucket: R2Bucket
  /** Registry DO namespace */
  registryDO: DurableObjectNamespace
  /** Cache TTL in milliseconds (default: 60000) */
  cacheTtl?: number
}

/**
 * Client for interacting with the DO registry
 *
 * Reads from R2 cache first, falls back to RegistryDO for writes and cache misses.
 */
export class RegistryClient {
  private bucket: R2Bucket
  private registryDO: DurableObjectNamespace
  private cacheTtl: number
  private cache = new Map<string, { snapshot: RegistrySnapshot; fetchedAt: number }>()

  constructor(options: RegistryClientOptions) {
    this.bucket = options.bucket
    this.registryDO = options.registryDO
    this.cacheTtl = options.cacheTtl ?? 60000
  }

  /**
   * Get a cached snapshot for a namespace
   */
  private async getSnapshot(namespace: string): Promise<RegistrySnapshot | null> {
    // Check in-memory cache first
    const cached = this.cache.get(namespace)
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtl) {
      return cached.snapshot
    }

    // Try R2
    const key = `registry/${namespace}/snapshot.json`
    const object = await this.bucket.get(key)

    if (!object) return null

    const snapshot = await object.json<RegistrySnapshot>()
    this.cache.set(namespace, { snapshot, fetchedAt: Date.now() })

    return snapshot
  }

  /**
   * Get an entry by name (from cache)
   */
  async get(namespace: string, name: string): Promise<RegistryEntry | null> {
    const snapshot = await this.getSnapshot(namespace)
    if (!snapshot) return null

    return snapshot.entries.find(e => e.name === name) ?? null
  }

  /**
   * Get the registry DO stub for writes
   */
  getRegistryStub(): DurableObjectStub {
    // Single global registry DO
    const id = this.registryDO.idFromName('global')
    return this.registryDO.get(id)
  }

  /**
   * Invalidate the cache for a namespace
   */
  invalidate(namespace: string): void {
    this.cache.delete(namespace)
  }
}
