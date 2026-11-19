// Solo una base nueva y sintética en el PostgreSQL temporal de esta prueba.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const db = process.env.NUVOO_CHAIN_TEST_DB ?? "";
if (!/^nuvoo_9b_chain_[a-f0-9]{32}$/.test(db)) throw new Error("Nombre de base sintética inválido");
const bin = "C:/Program Files/PostgreSQL/18/bin/psql.exe";
const args = ["-h", "127.0.0.1", "-p", "55449", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-qAt"];
const run = (input) => execFileSync(bin, args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const directory = run("SHOW data_directory;").trim().replaceAll("\\", "/").toLowerCase();
if (!directory.endsWith("/temp/nuvoo-cafc-pg-task")) throw new Error("El servidor no corresponde al clúster sintético");
if (run("SELECT count(*) FROM information_schema.tables WHERE table_schema='public';").trim() !== "0") throw new Error("La base sintética debe estar vacía");
run("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid'; CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(bucket_id text,name text);");
// El snapshot histórico lista FKs antes de algunas PK; reordenar solo en memoria.
let base = readFileSync("supabase/migraciones/20260908120000_initial_schema.sql", "utf8");
const primary = [...base.matchAll(/ALTER TABLE public\.[\w]+\s+ADD CONSTRAINT [\w]+ PRIMARY KEY \([^;]+\);/g)].map(match => match[0]);
if (primary.length < 5) throw new Error("Snapshot base no reconocido");
base = base.replace(/ALTER TABLE public\.[\w]+\s+ADD CONSTRAINT [\w]+ PRIMARY KEY \([^;]+\);/g, "");
const firstAlter = base.indexOf("ALTER TABLE public.");
if (firstAlter < 0) throw new Error("Snapshot base no reconocido");
run(base.slice(0, firstAlter) + primary.join("\n") + "\n" + base.slice(firstAlter));
run(readFileSync("supabase/migraciones/20260908130000_clientes_integracion.sql", "utf8"));
const files = readdirSync("supabase/migrations").filter(name => name.endsWith(".sql") && name !== "20260918175000_prueba_persistencia_producto.sql").sort();
for (const file of files) {
  try { run(readFileSync(resolve("supabase/migrations", file), "utf8")); }
  catch (error) { throw new Error(`Falló ${basename(file)}: ${String(error.stderr ?? error.message)}`); }
  if (file === "20261103020000_siat_aislar_tareas_paso9.sql") {
    // Probar también el intervalo real antes de 0300, sin su tabla de notificaciones.
    run(`BEGIN;
      INSERT INTO public.siat_outbox (tipo_tarea,payload,estado,idempotency_key)
      VALUES ('ANULAR_FACTURA','{}','PENDIENTE','test-paso9-transicion-anulacion'),
             ('RENOVAR_CUIS','{}','PENDIENTE','test-paso9-transicion-normal');
      DO $$ DECLARE tarea public.siat_outbox%ROWTYPE; BEGIN
        IF to_regclass('public.siat_9a_notificaciones') IS NOT NULL THEN RAISE EXCEPTION 'Tabla 0300 ya existe'; END IF;
        SELECT * INTO tarea FROM public.siat_reclamar_outbox_9a('test-transicion',120,true);
        IF tarea.tipo_tarea IS DISTINCT FROM 'RENOVAR_CUIS' THEN RAISE EXCEPTION 'La transición bloqueó el flujo anterior'; END IF;
        IF EXISTS (SELECT 1 FROM public.siat_reclamar_outbox_9a('test-transicion',120,true)) THEN RAISE EXCEPTION 'La transición permitió anulación'; END IF;
      END $$; ROLLBACK;`);
  }
  if (file === "20261103030000_siat_9a_evidencias.sql") {
    // El trigger no debe impedir cambios de estado ajenos a anulación/reversión.
    run(`BEGIN;
      CREATE TEMP TABLE prueba_estado_fiscal(id uuid, estado_fiscal text);
      CREATE TRIGGER prueba_destino BEFORE UPDATE OF estado_fiscal ON prueba_estado_fiscal
        FOR EACH ROW EXECUTE FUNCTION public.siat_9a_validar_destino();
      INSERT INTO prueba_estado_fiscal VALUES(gen_random_uuid(),'ENVIANDO');
      UPDATE prueba_estado_fiscal SET estado_fiscal='VALIDADA';
      DO $$ BEGIN
        BEGIN
          UPDATE prueba_estado_fiscal SET estado_fiscal='ANULACION_PENDIENTE';
          RAISE EXCEPTION 'Aceptó anulación sin destinatario';
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM <> 'Falta destinatario privado declarado para la notificación.' THEN RAISE; END IF;
        END;
      END $$; ROLLBACK;`);
  }
}
process.stdout.write(`Cadena sintética: ${files.length} migraciones de esquema, incluidas 0100–0800.\n`);
