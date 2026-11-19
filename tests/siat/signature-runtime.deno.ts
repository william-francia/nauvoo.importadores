// Local-only regression: OpenSSL creates disposable credentials, never used by Edge Functions.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateSignatureCredentials } from "../../supabase/functions/_shared/siat/signature-credentials.ts";
import { testSignatureIsolated } from "../../supabase/functions/_shared/siat/signature-test.ts";
import { xsdSiat } from "../../supabase/functions/_shared/siat/xsd-embebidos.ts";

Deno.test("PKCS8, X509, par RSA, XMLDSig y XSD en Deno sin Buffer global", async () => {
  const openssl = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].find((candidate) => {
    try { execFileSync(candidate, ["version"], { stdio: "ignore" }); return true; } catch { return false; }
  });
  assert.ok(openssl, "Se necesita OpenSSL local para generar el certificado efímero");
  const prefix = resolve(tmpdir(), "siat-runtime-");
  const directory = mkdtempSync(prefix);
  const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  try {
    const keyPath = join(directory, "key.pem"); const certPath = join(directory, "cert.pem");
    execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=SIAT Runtime Test", "-addext", "keyUsage=digitalSignature", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
    const key = readFileSync(keyPath, "utf8"); const cert = readFileSync(certPath, "utf8");
    // Deno/Edge versions need not expose Node globals in application modules.
    Reflect.deleteProperty(globalThis, "Buffer");
    assert.equal(validateSignatureCredentials(key, cert).nit, "NIT_VERIFICACION_MANUAL");
    const artifacts = new URL("../../supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/", import.meta.url);
    const result = await testSignatureIsolated(key, cert, (name) => Deno.readTextFile(new URL(name, artifacts)));
    assert.equal(result.firma, true);
    assert.equal(result.xsd, true);
    const embedded = await testSignatureIsolated(key, cert, async (name) => xsdSiat(name));
    assert.equal(embedded.firma, true);
    assert.equal(embedded.xsd, true);
  } finally {
    if (bufferDescriptor) Object.defineProperty(globalThis, "Buffer", bufferDescriptor);
    assert.ok(resolve(directory).startsWith(prefix));
    rmSync(directory, { recursive: true, force: true });
  }
});
