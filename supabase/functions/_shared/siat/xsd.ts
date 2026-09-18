import { ParseOption, XmlDocument, XsdValidator } from "libxml2-wasm";

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
  const signatureMatch = xml.match(/<(?:ds:)?Signature\b[\s\S]*?<\/(?:ds:)?Signature>/);
  if (!signatureMatch) throw new Error("La factura electrónica no contiene XMLDSig.");
  const baseXml = xml.replace(signatureMatch[0], "");
  const baseSchema = electronicXsd
    .replace(/\s*<xs:import[^>]+\/>/, "")
    .replace(/\s*<xs:element ref="ds:Signature"\/>/, "");
  validateXmlAgainstXsd(baseXml, baseSchema);
  const signature = /^<Signature\b[^>]*\bxmlns=/.test(signatureMatch[0])
    ? signatureMatch[0]
    : signatureMatch[0].replace(/^<Signature\b/, '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"');
  validateXmlAgainstXsd(signature, signatureXsd);
  return true;
}
