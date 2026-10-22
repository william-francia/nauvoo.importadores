import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";
import { X509Certificate } from "node:crypto";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const C14N_WITH_COMMENTS = `${C14N}#WithComments`;
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";
const DSIG_NAMESPACE = "http://www.w3.org/2000/09/xmldsig#";
const ENVELOPED_SIGNATURE = `${DSIG_NAMESPACE}enveloped-signature`;

type XmlDocument = ReturnType<DOMParser["parseFromString"]>;

const single = (document: XmlDocument, localName: string) => {
  const elements = document.getElementsByTagNameNS(DSIG_NAMESPACE, localName);
  if (elements.length !== 1) throw new Error(`XMLDSig requiere exactamente un elemento ${localName}.`);
  return elements.item(0)!;
};

const nonEmptyBase64 = (value: string | null | undefined, label: string) => {
  const normalized = String(value ?? "").replace(/\s/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error(`${label} XMLDSig no contiene Base64 válido.`);
};

export function validateInvoiceSignatureProfile(xml: string): true {
  const document = new DOMParser().parseFromString(xml, "text/xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("El XML firmado no está bien formado.");
  const root = document.documentElement;
  if (!root) throw new Error("El XML firmado no contiene un elemento raíz.");
  const signature = single(document, "Signature");
  if (signature.parentNode !== root) throw new Error("Signature debe ser hijo directo de la factura.");
  let lastElement = null;
  for (let index = 0; index < root.childNodes.length; index += 1) if (root.childNodes.item(index)?.nodeType === 1) lastElement = root.childNodes.item(index);
  if (lastElement !== signature) throw new Error("Signature debe ser el último elemento de la factura electrónica.");
  if (single(document, "CanonicalizationMethod").getAttribute("Algorithm") !== C14N) throw new Error("CanonicalizationMethod XMLDSig no corresponde al perfil SIAT.");
  if (single(document, "SignatureMethod").getAttribute("Algorithm") !== RSA_SHA256) throw new Error("SignatureMethod XMLDSig no corresponde a RSA-SHA256.");
  const reference = single(document, "Reference");
  if (reference.getAttribute("URI") !== "") throw new Error("Reference XMLDSig debe abarcar el documento completo.");
  const transforms = document.getElementsByTagNameNS(DSIG_NAMESPACE, "Transform");
  const algorithms = Array.from({ length: transforms.length }, (_, index) => transforms.item(index)!.getAttribute("Algorithm"));
  if (algorithms.length !== 2 || algorithms[0] !== ENVELOPED_SIGNATURE || algorithms[1] !== C14N_WITH_COMMENTS) throw new Error("Transforms XMLDSig no corresponden al perfil SIAT.");
  if (single(document, "DigestMethod").getAttribute("Algorithm") !== SHA256) throw new Error("DigestMethod XMLDSig no corresponde a SHA-256.");
  nonEmptyBase64(single(document, "DigestValue").textContent, "DigestValue");
  nonEmptyBase64(single(document, "SignatureValue").textContent, "SignatureValue");
  nonEmptyBase64(single(document, "X509Certificate").textContent, "X509Certificate");
  return true;
}

export function signInvoiceXml(xml: string, privateKeyPem: string, certificatePem: string): string {
  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(privateKeyPem) || !certificatePem.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Certificado X.509 o clave privada de firma no configurados.");
  const signer = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    getKeyInfoContent: ({ publicCert, prefix } = {}) => {
      const tag = (name: string) => prefix ? `${prefix}:${name}` : name;
      const body = String(publicCert ?? certificatePem).replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
      return `<${tag("X509Data")}><${tag("X509Certificate")}>${body}</${tag("X509Certificate")}></${tag("X509Data")}>`;
    },
    canonicalizationAlgorithm: C14N,
    signatureAlgorithm: RSA_SHA256,
  });
  signer.addReference({
    xpath: "/*",
    transforms: [ENVELOPED_SIGNATURE, C14N_WITH_COMMENTS],
    digestAlgorithm: SHA256,
    isEmptyUri: true,
  });
  signer.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  const signed = signer.getSignedXml();
  validateInvoiceSignatureProfile(signed);
  verifyInvoiceSignature(signed, certificatePem);
  return signed;
}

export function verifyInvoiceSignature(xml: string, certificatePem: string): true {
  if (!certificatePem.includes("-----BEGIN CERTIFICATE-----")) throw new Error("Se requiere un certificado X.509 para verificar XMLDSig.");
  validateInvoiceSignatureProfile(xml);
  const embedded = String(single(new DOMParser().parseFromString(xml, "text/xml"), "X509Certificate").textContent ?? "").replace(/\s/g, "");
  try {
    const configured = new X509Certificate(certificatePem);
    if (embedded !== configured.raw.toString("base64")) throw new Error("FIRMA_KEYINFO_NO_CORRESPONDE");
  } catch (error) {
    if (error instanceof Error && error.message === "FIRMA_KEYINFO_NO_CORRESPONDE") throw error;
    throw new Error("FIRMA_PEM_INVALIDO", { cause: error });
  }
  const verifier = new SignedXml({ publicCert: certificatePem });
  const document = new DOMParser().parseFromString(xml, "text/xml") as unknown as Parameters<typeof verifier.findSignatures>[0];
  const signatures = verifier.findSignatures(document);
  if (signatures.length !== 1) throw new Error("El XML debe contener exactamente una firma XMLDSig.");
  verifier.loadSignature(signatures[0]!);
  if (!verifier.checkSignature(xml)) throw new Error("Firma XMLDSig inválida.");
  return true;
}
