// Los XSD se incluyen como texto para despliegues Edge por API sin Docker.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("supabase/functions/_shared/siat");
const names = ["facturaElectronicaCompraVenta.xsd", "facturaComputarizadaCompraVenta.xsd", "SignatureSchema.xsd"];
const entries = names.map(name => `  ${JSON.stringify(name)}: ${JSON.stringify(readFileSync(resolve(root, "artifacts/SIAT_VIGENTE", name), "utf8"))}`).join(",\n");
writeFileSync(resolve(root, "xsd-embebidos.ts"), `// Generado por scripts/generar-xsd-siat.mjs; no editar manualmente.\nexport const XSD_SIAT: Readonly<Record<string, string>> = {\n${entries}\n};\n\nexport function xsdSiat(name: string): string {\n  const value = XSD_SIAT[name];\n  if (!value) throw new Error(\`XSD SIAT no disponible: \${name}\`);\n  return value;\n}\n`);
