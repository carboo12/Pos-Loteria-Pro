import "dotenv/config";
import { createRequire } from "node:module";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const adminModule = require("firebase-admin");
const firestoreModule = require("firebase-admin/firestore");
const admin = adminModule.default || adminModule;
const outputDir = path.resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) || "exports/firestore");
const databaseId = process.env.FIRESTORE_DATABASE_ID || "ai-studio-puntodeventadelo-99bc134f-793f-40a0-acdb-49f626766fdc";
const configJson = process.env.FIREBASE_CONFIG_JSON;
if (!configJson) throw new Error("Define FIREBASE_CONFIG_JSON en el entorno seguro del proceso de exportación.");

const credentialJson = JSON.parse(configJson);
const app = admin.initializeApp({ credential: admin.credential.cert(credentialJson), projectId: credentialJson.project_id });
const firestore = firestoreModule.getFirestore(app, databaseId);
mkdirSync(outputDir, { recursive: true });

function normalize(value: any): any {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
  return value;
}

async function writeCollection(collectionName: string, filename = `${collectionName}.jsonl`) {
  const snapshot = await firestore.collection(collectionName).get();
  const stream = createWriteStream(path.join(outputDir, filename), { encoding: "utf8" });
  for (const document of snapshot.docs) stream.write(`${JSON.stringify({ id: document.id, data: normalize(document.data()) })}\n`);
  await new Promise<void>((resolve, reject) => { stream.end(resolve); stream.on("error", reject); });
  console.log(`${collectionName}: ${snapshot.size} documentos -> ${filename}`);
}

async function main() {
  for (const collectionName of ["usuarios", "tickets", "resultados", "cierres_caja", "resumenes_diarios", "cobros_admin", "pagos_comision", "logs_auditoria"]) {
    await writeCollection(collectionName);
  }
  await writeCollection("configuracion", "configuracion.jsonl");
  console.log(`Exportación completa en ${outputDir}. Protege estos archivos: pueden contener hashes/credenciales antiguas.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
