import { ParseOption, XmlDocument, XsdValidator } from "libxml2-wasm";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const DSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";

const electronicSchemaWithoutSignature = (xsd: string) => xsd
  .replace(/\s*<xs:import\b[^>]*namespace=["']http:\/\/www\.w3\.org\/2000\/09\/xmldsig#["'][^>]*\/>/, "")
  .replace(/\s*<xs:element\b[^>]*ref=["']ds:Signature["'][^>]*\/>/, "");

export function validateUnsignedElectronicInvoiceXml(xml: string, electronicXsd: string): true {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("El XML de factura no está bien formado.");
  if (document.getElementsByTagNameNS(DSIG_NAMESPACE, "Signature").length) throw new Error("La validación previa requiere un XML todavía no firmado.");
  return validateXmlAgainstXsd(xml, electronicSchemaWithoutSignature(electronicXsd));
}

export function validateXmlAgainstXsd(xml: string, xsd: string): true {
  const safeOptions = { option: ParseOption.XML_PARSE_NONET | ParseOption.XML_PARSE_NO_XXE | ParseOption.XML_PARSE_NO_SYS_CATALOG };
  const xmlDocument = XmlDocument.fromString(xml, safeOptions);
  const xsdDocument = XmlDocument.fromString(xsd, safeOptions);
  const validator = XsdValidator.fromDoc(xsdDocument);
  try {
    validator.validate(xmlDocument);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`XML inválido según XSD oficial: ${message}`, { cause: error });
  } finally {
    validator.dispose();
    xsdDocument.dispose();
    xmlDocument.dispose();
  }
}

export function validateElectronicInvoiceXml(xml: string, electronicXsd: string, signatureXsd: string): true {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("El XML firmado no está bien formado.");
  const root = document.documentElement;
  if (!root) throw new Error("El XML firmado no contiene un elemento raíz.");
  const signatures = document.getElementsByTagNameNS(DSIG_NAMESPACE, "Signature");
  if (signatures.length !== 1) throw new Error("La factura electrónica debe contener exactamente una firma XMLDSig.");
  const signature = signatures.item(0)!;
  if (signature.parentNode !== root) throw new Error("Signature debe ser hijo directo de la factura electrónica.");
  let lastElement = null;
  for (let index = 0; index < root.childNodes.length; index += 1) if (root.childNodes.item(index)?.nodeType === 1) lastElement = root.childNodes.item(index);
  if (lastElement !== signature) throw new Error("Signature debe ser el último elemento de la factura electrónica.");
  const signatureXml = new XMLSerializer().serializeToString(signature);
  root.removeChild(signature);
  const baseXml = new XMLSerializer().serializeToString(document);
  validateXmlAgainstXsd(baseXml, electronicSchemaWithoutSignature(electronicXsd));
  validateXmlAgainstXsd(signatureXml, signatureXsd);
  return true;
}
