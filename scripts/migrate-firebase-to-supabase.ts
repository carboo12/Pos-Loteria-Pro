import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { randomBytes } from "node:crypto";

type LegacyDoc = { id: string; data: Record<string, any> };
type Bucket = "usuarios" | "tickets" | "resultados" | "cierres_caja" | "resumenes_diarios" | "cobros_admin" | "pagos_comision" | "configuracion" | "logs_auditoria";
const buckets: Bucket[] = ["usuarios", "tickets", "resultados", "cierres_caja", "resumenes_diarios", "cobros_admin", "pagos_comision", "configuracion", "logs_auditoria"];
const dryRun = process.argv.includes("--dry-run");
const inputDirArg = process.argv.find((arg) => arg.startsWith("--input="))?.slice("--input=".length) || "exports/firestore";
const inputDir = path.resolve(inputDirArg);
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const batchSize = Math.max(1, Number(process.env.MIGRATION_BATCH_SIZE || 250));

if (!url) throw new Error("Define SUPABASE_URL en el entorno del proceso.");
if (!serviceKey && !dryRun) throw new Error("Define SUPABASE_SERVICE_ROLE_KEY en un entorno seguro para ejecutar la carga.");
if (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY) {
  console.warn("El importador debe usar service role solo en entorno seguro; nunca incluyas esta clave en código frontend.");
}
const supabase = createClient(url, serviceKey || "dry-run-no-database-access", { auth: { persistSession: false, autoRefreshToken: false } });

function normalize(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    if (value._seconds != null) return new Date(Number(value._seconds) * 1000).toISOString();
    if (value.seconds != null && Object.keys(value).length <= 2) return new Date(Number(value.seconds) * 1000).toISOString();
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  }
  return value;
}

async function readBucket(bucket: Bucket): Promise<LegacyDoc[]> {
  const file = path.join(inputDir, `${bucket}.jsonl`);
  if (!existsSync(file)) return [];
  const docs: LegacyDoc[] = [];
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (!parsed.id || !parsed.data || typeof parsed.data !== "object") throw new Error(`Documento mal formado en ${file}: ${line.slice(0, 120)}`);
    docs.push({ id: String(parsed.id), data: normalize(parsed.data) });
  }
  return docs;
}

function requiredText(value: any, label: string): string {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} no puede estar vacío`);
  return result;
}
function uuidOrMapped(legacyId: any, map: Map<string, string>, label: string): string {
  const key = requiredText(legacyId, label);
  const mapped = map.get(key);
  if (!mapped) throw new Error(`${label} huérfano: ${key}`);
  return mapped;
}
function num(value: any, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function ticketPublicId(value: any, label: string): string {
  const raw = requiredText(value, label);
  if (!/^\d{1,7}$/.test(raw)) throw new Error(`${label}: identificador inválido (${raw})`);
  return raw.length < 6 ? raw.padStart(6, "0") : raw;
}
function dateOnly(value: any, fallback?: string): string {
  const raw = String(value || fallback || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`Fecha inválida: ${value}`);
  return raw;
}
async function upsert(table: string, rows: Record<string, any>[], conflict: string): Promise<void> {
  if (!rows.length) return;
  if (dryRun) { console.log(`[dry-run] ${table}: ${rows.length} filas validadas`); return; }
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const { error } = await supabase.from(table).upsert(batch, { onConflict: conflict });
    if (error) throw new Error(`${table} lote ${start}: ${error.message}`);
  }
}

async function findAuthUserByEmail(email: string): Promise<{ id: string } | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`No se pudieron consultar usuarios Auth: ${error.message}`);
    const authUsers = (data?.users || []) as Array<{ id: string; email?: string }>;
    const found = authUsers.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return { id: found.id };
    if (authUsers.length < 1000) return null;
  }
  throw new Error("Se alcanzó el máximo de páginas al buscar una cuenta de Auth.");
}

async function main() {
  const docs = Object.fromEntries(await Promise.all(buckets.map(async (bucket) => [bucket, await readBucket(bucket)]))) as Record<Bucket, LegacyDoc[]>;
  for (const bucket of buckets) console.log(`${bucket}: ${docs[bucket].length} documentos`);
  const usersByLegacy = new Map<string, string>();
  const adminLegacyUser = docs.usuarios.find((item) => ["admin", "administrador"].includes(String(item.data.rol).toLowerCase()));
  const adminUsername = String(process.env.MIGRATION_ADMIN_USERNAME || adminLegacyUser?.data.usuario || "").trim().toLowerCase();
  const adminInitialPassword = process.env.MIGRATION_ADMIN_INITIAL_PASSWORD || "";
  if (dryRun) {
    for (const user of docs.usuarios) usersByLegacy.set(user.id, `dry-run-${user.id}`);
  } else {
    const { data: existingProfiles, error: profileLookupError } = await supabase.from("profiles").select("id,legacy_firestore_id,usuario,email");
    if (profileLookupError) throw new Error(`No se pudieron leer perfiles existentes: ${profileLookupError.message}`);
    for (const legacyUser of docs.usuarios) {
      const username = requiredText(legacyUser.data.usuario, `usuario ${legacyUser.id}.usuario`).toLowerCase();
      if (!/^[a-z0-9_]{2,40}$/.test(username)) throw new Error(`Usuario ${legacyUser.id}: username inválido (${username})`);
      const internalEmail = `${username}@app.local`;
      let authId = existingProfiles?.find((profile: any) => profile.legacy_firestore_id === legacyUser.id || profile.usuario === username)?.id as string | undefined;
      if (authId) {
        const { error } = await supabase.auth.admin.updateUserById(authId, { email: internalEmail, email_confirm: true });
        if (error) throw new Error(`No se pudo actualizar el email interno de @${username}: ${error.message}`);
      } else {
        const existingAuth = await findAuthUserByEmail(internalEmail);
        if (existingAuth) authId = existingAuth.id;
        else {
          const isBootstrapAdmin = username === adminUsername;
          if (isBootstrapAdmin && adminInitialPassword.length < 8) {
            throw new Error(`Define MIGRATION_ADMIN_INITIAL_PASSWORD (mínimo 8 caracteres) para crear al administrador @${username}.`);
          }
          const initialPassword = isBootstrapAdmin ? adminInitialPassword : randomBytes(32).toString("base64url");
          const { data: created, error } = await supabase.auth.admin.createUser({
            email: internalEmail, password: initialPassword, email_confirm: true, user_metadata: { username },
          });
          if (error || !created.user) throw new Error(`No se pudo provisionar @${username}: ${error?.message || "sin usuario devuelto"}`);
          authId = created.user.id;
        }
      }
      usersByLegacy.set(legacyUser.id, authId!);
    }
  }

  const profiles = docs.usuarios.map(({ id, data: d }) => ({
    id: usersByLegacy.get(id)!, legacy_firestore_id: id, nombre: requiredText(d.nombre, `usuario ${id}.nombre`),
    usuario: requiredText(d.usuario, `usuario ${id}.usuario`).toLowerCase(), rol: d.rol, estado: d.estado === "inactivo" ? "inactivo" : "activo",
    region: requiredText(d.region, `usuario ${id}.region`), email: `${requiredText(d.usuario, `usuario ${id}.usuario`).toLowerCase()}@app.local`,
    id_supervisor: d.id_supervisor ? uuidOrMapped(d.id_supervisor, usersByLegacy, `usuario ${id}.id_supervisor`) : null,
  }));
  await upsert("profiles", profiles, "id");

  const general = docs.usuarios.find((x) => x.data.configuracion)?.data.configuracion || {};
  const configDoc = docs.configuracion.find((x) => x.id === "general")?.data || {};
  const config = { ...general, ...configDoc };
  const draws = (Array.isArray(config.sorteos) ? config.sorteos : []).map((d: any) => {
    const row = { legacy_id: requiredText(d.id, "sorteo.id"), juego: requiredText(d.juego, "sorteo.juego"), hora_sorteo: d.hora_sorteo, hora_cierre: d.hora_cierre, nombre: requiredText(d.nombre, "sorteo.nombre"), dias_habilitados: d.dias_habilitados || null, pais: d.pais || null, activo: d.activo !== false };
    if (!row.hora_sorteo || !row.hora_cierre) throw new Error(`Sorteo ${row.legacy_id}: faltan horas`);
    return row;
  });
  await upsert("draws", draws, "legacy_id");

  const { data: drawRows, error: drawLookupError } = dryRun
    ? { data: draws.map((draw: any) => ({ id: draw.legacy_id, legacy_id: draw.legacy_id })), error: null }
    : await supabase.from("draws").select("id,legacy_id");
  if (drawLookupError) throw drawLookupError;
  const drawUuidByLegacy = new Map<string, string>((drawRows || []).map((d: any) => [d.legacy_id, d.id]));
  const results = docs.resultados.map(({ id, data: d }) => ({
    legacy_id: id, draw_id: uuidOrMapped(d.id_sorteo, drawUuidByLegacy, `resultado ${id}.id_sorteo`),
    fecha: dateOnly(d.fecha), numero_ganador: requiredText(d.numero_ganador, `resultado ${id}.numero_ganador`), timestamp: d.timestamp || new Date().toISOString(),
  }));
  await upsert("draw_results", results, "legacy_id");

  const numberLimits = (Array.isArray(config.limites_numeros) ? config.limites_numeros : []).map((item: any, index: number) => ({
    legacy_id: String(item.id || `config-limit-${index}`),
    seller_id: item.id_vendedor || item.vendedorId ? usersByLegacy.get(String(item.id_vendedor || item.vendedorId)) || null : null,
    draw_id: item.id_sorteo ? drawUuidByLegacy.get(String(item.id_sorteo)) || null : null,
    juego: requiredText(item.juego || "legacy", `limite ${index}.juego`),
    numero: requiredText(item.numero || item.numero_jugado, `limite ${index}.numero`),
    max_monto: num(item.max_monto ?? item.montoMaximo ?? item.techo_dinero), pais: item.pais || null, hora: item.hora || item.hora_limite || null,
  }));
  await upsert("number_limits", numberLimits, "legacy_id");

  const tickets = docs.tickets.map(({ id, data: d }) => {
    const publicId = ticketPublicId(d.id_ticket || d.numero_ticket || id, `ticket ${id}.id_ticket`);
    const numeroTicket = d.numero_ticket ? ticketPublicId(d.numero_ticket, `ticket ${id}.numero_ticket`) : publicId;
    if (d.id_ticket && d.numero_ticket && publicId !== numeroTicket) throw new Error(`Ticket ${id}: id_ticket y numero_ticket difieren (${publicId} / ${numeroTicket})`);
    return {
      id_ticket: publicId, numero_ticket: numeroTicket, legacy_firestore_id: id,
      id_vendedor: uuidOrMapped(d.id_vendedor, usersByLegacy, `ticket ${id}.id_vendedor`),
      id_sorteo: d.id_sorteo ? drawUuidByLegacy.get(String(d.id_sorteo)) || null : null,
      timestamp_servidor: d.timestamp_servidor || d.fecha_emision || new Date().toISOString(), fecha_venta: dateOnly(d.fecha_venta, d.timestamp_servidor),
      juego: requiredText(d.juego || d.id_juego, `ticket ${id}.juego`), sorteo: requiredText(d.sorteo || d.juego_sorteo || "Sin sorteo", `ticket ${id}.sorteo`),
      numero_jugado: String(d.numero_jugado || ""), monto_pago: num(d.monto_pago ?? d.total_apostado), moneda: d.moneda === "USD" ? "USD" : "C$",
      nombre_cliente: d.nombre_cliente || null, premio_posible_cs: num(d.premio_posible_cs), firma_digital: requiredText(d.firma_digital, `ticket ${id}.firma_digital`),
      anulado: Boolean(d.anulado), estado: ["pendiente", "pagado", "anulado", "perdedor", "cobrado"].includes(d.estado) ? d.estado : "pendiente",
      es_premiado: Boolean(d.es_premiado), monto_premio: num(d.monto_premio), fecha_pago: d.fecha_pago || null,
    };
  });
  await upsert("tickets", tickets, "legacy_firestore_id");

  const { data: ticketRows, error: ticketLookupError } = dryRun
    ? { data: docs.tickets.map(({ id }) => ({ id, legacy_firestore_id: id })), error: null }
    : await supabase.from("tickets").select("id,legacy_firestore_id");
  if (ticketLookupError) throw ticketLookupError;
  const ticketUuidByLegacy = new Map<string, string>((ticketRows || []).map((t: any) => [t.legacy_firestore_id, t.id]));
  const plays = docs.tickets.flatMap(({ id, data: d }) => (Array.isArray(d.jugadas) ? d.jugadas : []).map((play: any, index: number) => ({
    ticket_id: uuidOrMapped(id, ticketUuidByLegacy, `ticket ${id}.id`), ordinal: index + 1, numero: requiredText(play.numero, `ticket ${id}.jugadas[${index}].numero`),
    monto: num(play.monto), premio_posible: num(play.premio_posible), dia_juego: play.dia_juego || null,
  })));
  await upsert("ticket_plays", plays, "ticket_id,ordinal");

  const closures = docs.cierres_caja.map(({ id, data: d }) => ({
    legacy_id: id, seller_id: uuidOrMapped(d.id_vendedor, usersByLegacy, `cierre ${id}.id_vendedor`), fecha: dateOnly(d.fecha),
    denominaciones: d.denominaciones || {}, monto_entregado_cs: num(d.monto_entregado_cs), monto_entregado_usd: num(d.monto_entregado_usd),
    monto_sistema_cs: num(d.monto_sistema_cs), monto_sistema_usd: num(d.monto_sistema_usd), descuadre_cs: num(d.descuadre_cs), descuadre_usd: num(d.descuadre_usd),
    cobrado: Boolean(d.cobrado), timestamp: d.timestamp || new Date().toISOString(),
  }));
  await upsert("cash_closures", closures, "legacy_id");

  const summaries = docs.resumenes_diarios.map(({ id, data: d }) => ({
    legacy_id: id, seller_id: uuidOrMapped(d.id_vendedor, usersByLegacy, `resumen ${id}.id_vendedor`), fecha: dateOnly(d.fecha),
    vendido: num(d.vendido), pagado: num(d.pagado), cierre: d.cierre === "pagado" ? "pagado" : "pendiente", egreso: num(d.egreso),
    timestamp_creacion: d.timestamp_creacion || new Date().toISOString(), timestamp_actualizacion: d.timestamp_actualizacion || new Date().toISOString(),
  }));
  await upsert("daily_summaries", summaries, "legacy_id");
  const { data: summaryRows, error: summaryError } = dryRun
    ? { data: summaries.map((row: any) => ({ id: row.legacy_id, legacy_id: row.legacy_id })), error: null }
    : await supabase.from("daily_summaries").select("id,legacy_id");
  if (summaryError) throw summaryError;
  const summaryUuidByLegacy = new Map<string, string>((summaryRows || []).map((row: any) => [row.legacy_id, row.id]));

  const collections = docs.cobros_admin.map(({ id, data: d }) => ({
    legacy_id: id, admin_id: uuidOrMapped(d.id_admin, usersByLegacy, `cobro ${id}.id_admin`),
    seller_id: uuidOrMapped(d.id_vendedor, usersByLegacy, `cobro ${id}.id_vendedor`),
    rango_inicio: dateOnly(d.rango_inicio), rango_fin: dateOnly(d.rango_fin), total_vendido: num(d.total_vendido),
    total_pagado: num(d.total_pagado), total_neto: num(d.total_neto), estado: d.estado === "anulado" ? "anulado" : "activo", timestamp: d.timestamp || new Date().toISOString(),
  }));
  await upsert("admin_collections", collections, "legacy_id");
  const { data: collectionRows, error: collectionError } = dryRun
    ? { data: collections.map((row: any) => ({ id: row.legacy_id, legacy_id: row.legacy_id })), error: null }
    : await supabase.from("admin_collections").select("id,legacy_id");
  if (collectionError) throw collectionError;
  const collectionUuidByLegacy = new Map<string, string>((collectionRows || []).map((row: any) => [row.legacy_id, row.id]));
  const collectionDays = docs.cobros_admin.flatMap(({ id, data: d }) => (Array.isArray(d.dias_cerrados) ? d.dias_cerrados : []).map((summaryLegacyId: string) => ({
    collection_id: uuidOrMapped(id, collectionUuidByLegacy, `cobro ${id}`),
    summary_id: uuidOrMapped(summaryLegacyId, summaryUuidByLegacy, `cobro ${id}.dias_cerrados`),
  })));
  await upsert("admin_collection_days", collectionDays, "collection_id,summary_id");

  const commissionPayments = docs.pagos_comision.map(({ id, data: d }) => ({
    legacy_id: id, admin_id: uuidOrMapped(d.id_admin, usersByLegacy, `pago comisión ${id}.id_admin`),
    seller_id: uuidOrMapped(d.id_vendedor, usersByLegacy, `pago comisión ${id}.id_vendedor`),
    collection_id: d.id_cobro_relacionado ? collectionUuidByLegacy.get(String(d.id_cobro_relacionado)) || null : null,
    monto_pago: num(d.monto_pago), concepto: requiredText(d.concepto, `pago comisión ${id}.concepto`),
    estado: d.estado === "anulado" ? "anulado" : "activo", timestamp: d.timestamp || new Date().toISOString(),
  }));
  await upsert("commission_payments", commissionPayments, "legacy_id");

  const auditRows = docs.logs_auditoria.map(({ id, data: d }) => ({
    legacy_id: id,
    actor_id: d.actor_id ? usersByLegacy.get(String(d.actor_id)) || null : null,
    action: requiredText(d.action || d.accion || "legacy_event", `auditoría ${id}.action`),
    entity: requiredText(d.entity || d.entidad || "legacy", `auditoría ${id}.entity`),
    entity_id: d.entity_id == null ? null : String(d.entity_id), details: d,
    created_at: d.timestamp || d.created_at || new Date().toISOString(),
  }));
  if (auditRows.length) console.log(`${dryRun ? "[dry-run] " : ""}audit_logs: ${auditRows.length} eventos validados (append-only)`);
  await upsert("audit_logs", auditRows, "legacy_id");

  const settings = config.tasa_cambio ? [{ id: "general", tasa_cambio: num(config.tasa_cambio, 36.5), contador_global_tickets: num(config.contador_global_tickets), formato_ticket: config.formato_ticket || {} }] : [];
  await upsert("app_settings", settings, "id");

  const configItems = [
    ...(Array.isArray(config.limites_numeros) ? config.limites_numeros.map((item: any) => ({ id: `limit:${item.id || JSON.stringify(item)}`, category: "number_limit", payload: item })) : []),
    ...(Array.isArray(config.cobros) ? config.cobros.map((item: any) => ({ id: `receipt:${item.id || JSON.stringify(item)}`, category: "seller_receipt", payload: item })) : []),
    ...(Array.isArray(config.ingresos) ? config.ingresos.map((item: any) => ({ id: `income:${item.id || JSON.stringify(item)}`, category: "income", payload: item })) : []),
    ...docs.configuracion.filter((item) => item.id === "fcm").flatMap(({ data }) => (Array.isArray(data.tokens) ? data.tokens : []).map((token: string, index: number) => ({ id: `fcm:${index}:${token}`, category: "fcm_token", payload: { token } }))),
  ];
  await upsert("legacy_config_items", configItems, "id");

  console.log(dryRun ? "Dry-run completado; no se escribieron datos." : "Importación de entidades configuradas completada.");
}

main().catch((error) => { console.error("Migración detenida:", error.message || error); process.exitCode = 1; });
