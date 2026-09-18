import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { AgentConfig } from "./config.ts";
import { decryptBytes, encryptBytes, sessionHash } from "./security.ts";
import type { BootstrapBundle, LocalInvoice, LocalSession, OperationalState } from "./types.ts";

type Command = { id: string; type: string; at: string; payload: Record<string, unknown> };
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => { try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; } };

export class AgentStore {
  private db!: Database; private sql!: SqlJsStatic; private queue: Promise<void> = Promise.resolve();
  private readonly dbPath: string; private readonly journalPath: string; private readonly backupPath: string;
  constructor(private readonly config: AgentConfig) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    this.dbPath = join(config.dataDir, "agent.sqlite.enc"); this.journalPath = join(config.dataDir, "agent.journal.enc"); this.backupPath = join(config.dataDir, "agent.sqlite.backup.enc");
  }
  async init() {
    this.sql = await initSqlJs({ locateFile: file => join(process.cwd(), "node_modules", "sql.js", "dist", file) });
    this.db = existsSync(this.dbPath) ? new this.sql.Database(decryptBytes(readFileSync(this.dbPath), this.config.storageSecret)) : new this.sql.Database();
    this.db.run(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY,type TEXT NOT NULL,applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,user_name TEXT NOT NULL,role TEXT NOT NULL,expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS stock(product_id TEXT NOT NULL,warehouse_id TEXT NOT NULL,quantity REAL NOT NULL,PRIMARY KEY(product_id,warehouse_id));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,data TEXT NOT NULL,state TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_event ON events(state) WHERE state='ACTIVO';
      CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE NOT NULL,event_id TEXT NOT NULL,number INTEGER NOT NULL,cuf TEXT UNIQUE NOT NULL,state TEXT NOT NULL,data TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(event_id) REFERENCES events(id));
      CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,entity_id TEXT NOT NULL UNIQUE,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT NOT NULL,last_error TEXT);
      CREATE TABLE IF NOT EXISTS cafc_usage(range_id TEXT NOT NULL,number INTEGER NOT NULL,invoice_id TEXT NOT NULL UNIQUE,PRIMARY KEY(range_id,number));
    `);
    await this.replayJournal(); await this.snapshot();
  }
  private async locked<T>(work: () => Promise<T>): Promise<T> {
    let release!: () => void; const previous = this.queue; this.queue = new Promise<void>(resolve => { release = resolve; });
    await previous; try { return await work(); } finally { release(); }
  }
  private append(command: Command) {
    const line = encryptBytes(Buffer.from(json(command)), this.config.storageSecret).toString("base64") + "\n";
    const fd = openSync(this.journalPath, "a", 0o600); try { writeSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
  }
  private apply(command: Command) {
    if ((this.db.exec("SELECT 1 FROM commands WHERE id=?", [command.id])[0]?.values.length ?? 0) > 0) return;
    this.db.run("BEGIN IMMEDIATE");
    try {
      const p = command.payload;
      if (command.type === "BOOTSTRAP") this.applyBootstrap(p.bundle as unknown as BootstrapBundle);
      else if (command.type === "SESSION") this.db.run("INSERT OR REPLACE INTO sessions VALUES(?,?,?,?,?)", [String(p.hash), String(p.userId), String(p.userName), String(p.role), String(p.expiresAt)]);
      else if (command.type === "STATE") { this.setMeta("state", p.state); this.setMeta("stateEvidence", p.evidence); }
      else if (command.type === "START_EVENT") this.db.run("INSERT INTO events VALUES(?,?,?,?,NULL)", [String(p.id), json(p.data), "ACTIVO", String(p.startedAt)]);
      else if (command.type === "CLOSE_EVENT") this.db.run("UPDATE events SET state='CERRADO',ended_at=?,data=? WHERE id=? AND state='ACTIVO'", [String(p.endedAt), json(p.data), String(p.id)]);
      else if (command.type === "INVOICE") this.applyInvoice(p);
      else if (command.type === "SYNCED") { this.db.run("UPDATE invoices SET state=?,data=? WHERE id=?", [String(p.state), json(p.data), String(p.id)]); this.db.run("UPDATE outbox SET state='COMPLETADO',last_error=NULL WHERE entity_id=?", [String(p.id)]); }
      else if (command.type === "OUTBOX_ERROR") this.db.run("UPDATE outbox SET state='PENDIENTE',attempts=attempts+1,next_at=?,last_error=? WHERE entity_id=?", [String(p.nextAt), String(p.error), String(p.id)]);
      else throw new Error(`Comando local desconocido: ${command.type}`);
      this.db.run("INSERT INTO commands VALUES(?,?,?)", [command.id, command.type, command.at]); this.db.run("COMMIT");
    } catch (error) { this.db.run("ROLLBACK"); throw error; }
  }
  private applyBootstrap(bundle: BootstrapBundle) {
    this.setMeta("bootstrap", bundle); this.setMeta("bootstrapAt", bundle.generatedAt);
    this.db.run("DELETE FROM products"); this.db.run("DELETE FROM clients"); this.db.run("DELETE FROM stock");
    const homologations = new Map(bundle.homologations.map(row => [String(row.producto_id), row]));
    const warehouses = new Map(bundle.warehouses.map(row => [String(row.id), row]));
    for (const product of bundle.products) this.db.run("INSERT INTO products VALUES(?,?)", [String(product.id), json({ ...product, homologacion: homologations.get(String(product.id)) ?? null })]);
    for (const client of bundle.clients) this.db.run("INSERT INTO clients VALUES(?,?)", [String(client.id), json(client)]);
    for (const item of bundle.stocks) this.db.run("INSERT INTO stock VALUES(?,?,?)", [String(item.producto_id), String(item.almacen_id), Number(item.cantidad_disponible ?? 0)]);
    if (bundle.numberBlock) { this.setMeta("numberBlock", bundle.numberBlock); this.setMeta("nextNumber", bundle.numberBlock.numero_desde ?? bundle.numberBlock.numeroDesde); }
    this.setMeta("warehouses", Object.fromEntries(warehouses));
  }
  private applyInvoice(p: Record<string, unknown>) {
    const invoice = p.invoice as unknown as LocalInvoice; const items = p.items as Array<Record<string, unknown>>;
    for (const item of items) {
      this.db.run("UPDATE stock SET quantity=quantity-? WHERE product_id=? AND warehouse_id=? AND quantity>=?", [Number(item.cantidad), String(item.productoId), String(item.almacenId), Number(item.cantidad)]);
      if (this.db.getRowsModified() !== 1) throw new Error("Stock local insuficiente o desactualizado.");
    }
    this.db.run("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)", [invoice.id, invoice.idempotencyKey, invoice.eventId, invoice.numeroFactura, invoice.cuf, invoice.estado, json(invoice), invoice.fechaEmision]);
    if (invoice.manualCafc) this.db.run("INSERT INTO cafc_usage VALUES(?,?,?)", [invoice.manualCafc.rangeId, invoice.manualCafc.numero, invoice.id]);
    this.db.run("INSERT INTO outbox VALUES(?,?,?,?,0,?,NULL)", [crypto.randomUUID(), "FACTURA", invoice.id, "PENDIENTE", new Date().toISOString()]);
    if (!invoice.manualCafc) this.setMeta("nextNumber", invoice.numeroFactura + 1);
  }
  private setMeta(key: string, value: unknown) { this.db.run("INSERT OR REPLACE INTO meta VALUES(?,?)", [key, json(value)]); }
  private meta<T>(key: string, fallback: T): T { const result = this.db.exec("SELECT value FROM meta WHERE key=?", [key]); return parse(result[0]?.values[0]?.[0], fallback); }
  private async mutate(type: string, payload: Record<string, unknown>, id: string = crypto.randomUUID()) {
    const command = { id, type, at: new Date().toISOString(), payload }; this.append(command); this.apply(command); await this.snapshot();
  }
  private async replayJournal() {
    if (!existsSync(this.journalPath)) return;
    const lines = readFileSync(this.journalPath, "utf8").split(/\r?\n/).filter(Boolean);
    for (const line of lines) this.apply(JSON.parse(decryptBytes(Buffer.from(line, "base64"), this.config.storageSecret).toString()) as Command);
  }
  private async snapshot() {
    const temp = `${this.dbPath}.tmp`; const encrypted = encryptBytes(this.db.export(), this.config.storageSecret);
    writeFileSync(temp, encrypted, { mode: 0o600 }); const fd = openSync(temp, "r+"); try { fsyncSync(fd); } finally { closeSync(fd); }
    if (existsSync(this.dbPath)) copyFileSync(this.dbPath, this.backupPath); renameSync(temp, this.dbPath);
    if (existsSync(this.journalPath)) unlinkSync(this.journalPath);
  }
  async saveBootstrap(bundle: BootstrapBundle) { return this.locked(() => this.mutate("BOOTSTRAP", { bundle })); }
  async createSession(rawToken: string, session: LocalSession) { return this.locked(() => this.mutate("SESSION", { hash: sessionHash(rawToken, this.config.storageSecret), ...session })); }
  authenticate(rawToken: string): LocalSession | null {
    const hash = sessionHash(rawToken, this.config.storageSecret); const result = this.db.exec("SELECT user_id,user_name,role,expires_at FROM sessions WHERE hash=? AND expires_at>?", [hash, new Date().toISOString()]);
    const row = result[0]?.values[0]; return row ? { id: hash, userId: String(row[0]), userName: String(row[1]), role: String(row[2]), expiresAt: String(row[3]) } : null;
  }
  async setState(state: OperationalState, evidence: unknown) { return this.locked(() => this.mutate("STATE", { state, evidence }, `state:${Date.now()}`)); }
  getState() { return { state: this.meta<OperationalState>("state", "DEGRADADO"), evidence: this.meta("stateEvidence", {}), event: this.activeEvent(), pending: this.pendingCount(), bootstrapAt: this.meta<string | null>("bootstrapAt", null) }; }
  getBootstrap() { return this.meta<BootstrapBundle | null>("bootstrap", null); }
  listProducts(query = "") { const rows = this.db.exec("SELECT p.id,p.data,s.warehouse_id,s.quantity FROM products p JOIN stock s ON s.product_id=p.id WHERE s.quantity>0 ORDER BY p.id")[0]?.values ?? []; const warehouses = this.meta<Record<string, Record<string, unknown>>>("warehouses", {}); const products = new Map<string, Record<string, unknown>>(); for (const row of rows) { const id = String(row[0]); const current = products.get(id) ?? { ...parse<Record<string, unknown>>(row[1], {}), stocks: [] }; const stocks = current.stocks as Array<Record<string, unknown>>; stocks.push({ almacen: warehouses[String(row[2])] ?? { id: row[2], nombre: "Almacén" }, cantidad: Number(row[3]) }); products.set(id, current); } return [...products.values()].filter(row => `${row.codigo_interno} ${row.nombre}`.toLowerCase().includes(query.toLowerCase())); }
  listClients(query = "") { const rows = this.db.exec("SELECT data FROM clients")[0]?.values ?? []; return rows.map(row => parse<Record<string, unknown>>(row[0], {})).filter(row => `${row.nombre_razon_social} ${row.numero_documento}`.toLowerCase().includes(query.toLowerCase())); }
  listCafc() { const bundle = this.getBootstrap(); return (bundle?.cafc ?? []).map(row => ({ id: row.id, autorizacion: row.autorizacion, rangoDesde: row.rango_desde, rangoHasta: row.rango_hasta, vigenteHasta: row.vigente_hasta, estado: row.estado })); }
  activeEvent() { const row = this.db.exec("SELECT data FROM events WHERE state='ACTIVO' LIMIT 1")[0]?.values[0]?.[0]; return parse<Record<string, unknown> | null>(row, null); }
  pendingRecoveryEvent() { if (!this.pendingCount()) return null; const row = this.db.exec("SELECT data FROM events WHERE state='CERRADO' ORDER BY ended_at DESC LIMIT 1")[0]?.values[0]?.[0]; return parse<Record<string, unknown> | null>(row, null); }
  async startEvent(data: Record<string, unknown>) { const id = String(data.id ?? crypto.randomUUID()); await this.locked(() => this.mutate("START_EVENT", { id, data: { ...data, id }, startedAt: data.fechaInicio ?? new Date().toISOString() })); return id; }
  async closeEvent(id: string, data: Record<string, unknown>) { return this.locked(() => this.mutate("CLOSE_EVENT", { id, data, endedAt: data.fechaFin ?? new Date().toISOString() })); }
  async createInvoice(build: (context: { bundle: BootstrapBundle; event: Record<string, unknown>; number: number; products: Record<string, unknown>[]; client: Record<string, unknown> }) => Promise<{ invoice: LocalInvoice; items: Array<Record<string, unknown>> }>, input: { idempotencyKey: string; clienteId: string; items: Array<Record<string, unknown>>; manualCafc?: { rangeId: string; numero: number } }) {
    return this.locked(async () => {
      const existing = this.db.exec("SELECT data FROM invoices WHERE idempotency_key=?", [input.idempotencyKey])[0]?.values[0]?.[0];
      if (existing) return parse<LocalInvoice>(existing, {} as LocalInvoice);
      const bundle = this.getBootstrap(); const event = this.activeEvent(); if (!bundle || !event) throw new Error("No existe aprovisionamiento o contingencia activa en el agente local.");
      let number = this.meta<number>("nextNumber", 0); const block = this.meta<Record<string, unknown> | null>("numberBlock", null);
      if (input.manualCafc) {
        const range = bundle.cafc.find(row => String(row.id) === input.manualCafc?.rangeId && row.estado === "VIGENTE");
        if (!range || input.manualCafc.numero < Number(range.rango_desde) || input.manualCafc.numero > Number(range.rango_hasta) || new Date(String(range.vigente_hasta)).getTime() < Date.now()) throw new Error("Número CAFC fuera del rango vigente.");
        if ((this.db.exec("SELECT 1 FROM cafc_usage WHERE range_id=? AND number=?", [input.manualCafc.rangeId, input.manualCafc.numero])[0]?.values.length ?? 0) > 0) throw new Error("El número manual CAFC ya fue utilizado.");
        number = input.manualCafc.numero;
      } else if (!number || !block || number > Number(block.numero_hasta ?? block.numeroHasta ?? 0)) throw new Error("No quedan números fiscales offline reservados.");
      const clientRaw = this.db.exec("SELECT data FROM clients WHERE id=?", [input.clienteId])[0]?.values[0]?.[0]; if (!clientRaw) throw new Error("Cliente no disponible en la caché local.");
      const products = input.items.map(item => { const raw = this.db.exec("SELECT data FROM products WHERE id=?", [String(item.productoId)])[0]?.values[0]?.[0]; if (!raw) throw new Error("Producto no disponible en la caché local."); return parse<Record<string, unknown>>(raw, {}); });
      const created = await build({ bundle, event, number, products, client: parse(clientRaw, {}) });
      await this.mutate("INVOICE", { invoice: created.invoice, items: created.items }, `invoice:${input.idempotencyKey}`); return created.invoice;
    });
  }
  listInvoices() { const rows = this.db.exec("SELECT data FROM invoices ORDER BY created_at DESC")[0]?.values ?? []; return rows.map(row => parse<LocalInvoice>(row[0], {} as LocalInvoice)); }
  pendingInvoices() { const rows = this.db.exec("SELECT i.data FROM invoices i JOIN outbox o ON o.entity_id=i.id WHERE o.state='PENDIENTE' AND o.next_at<=? ORDER BY i.created_at", [new Date().toISOString()])[0]?.values ?? []; return rows.map(row => parse<LocalInvoice>(row[0], {} as LocalInvoice)); }
  pendingCount() { return Number(this.db.exec("SELECT COUNT(*) FROM outbox WHERE state='PENDIENTE'")[0]?.values[0]?.[0] ?? 0); }
  async markSynced(invoice: LocalInvoice, response: Record<string, unknown>) { const data = { ...invoice, estado: "EN_COLA", syncError: null, remote: response }; return this.locked(() => this.mutate("SYNCED", { id: invoice.id, state: "EN_COLA", data })); }
  async markOutboxError(id: string, error: string, attempt: number) { const delay = Math.min(3_600_000, 5_000 * (2 ** Math.min(attempt, 8))); return this.locked(() => this.mutate("OUTBOX_ERROR", { id, error: error.slice(0, 500), nextAt: new Date(Date.now() + delay).toISOString() }, `error:${id}:${attempt}`)); }
  writeArtifact(relative: string, data: Uint8Array) { const path = join(this.config.dataDir, "documents", `${relative}.enc`); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, encryptBytes(data, this.config.storageSecret), { mode: 0o600 }); return path; }
  readArtifact(path: string) { if (!path.startsWith(join(this.config.dataDir, "documents"))) throw new Error("Ruta fiscal inválida."); return decryptBytes(readFileSync(path), this.config.storageSecret); }
  backup(target: string) { const destination = join(target, `siat-agent-${new Date().toISOString().replace(/[:.]/g, "-")}.enc`); mkdirSync(target, { recursive: true }); copyFileSync(this.dbPath, destination); return destination; }
}
