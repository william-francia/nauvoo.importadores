import { SignedXml } from "xml-crypto";
import { DOMParser } from "@xmldom/xmldom";

const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const C14N_WITH_COMMENTS = `${C14N}#WithComments`;
const RSA_SHA256 = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
const SHA256 = "http://www.w3.org/2001/04/xmlenc#sha256";

export function signInvoiceXml(xml: string, privateKeyPem: string, certificatePem: string): string {
  if (!privateKeyPem.includes("PRIVATE KEY") || !/(CERTIFICATE|PUBLIC KEY)/.test(certificatePem)) throw new Error("Certificado o clave privada de firma no configurados.");
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
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", C14N_WITH_COMMENTS],
    digestAlgorithm: SHA256,
    isEmptyUri: true,
  });
  signer.computeSignature(xml, { location: { reference: "/*", action: "append" } });
  const signed = signer.getSignedXml();
  verifyInvoiceSignature(signed, certificatePem);
  return signed;
}

export function verifyInvoiceSignature(xml: string, certificatePem: string): true {
  const verifier = new SignedXml({ publicCert: certificatePem });
  const document = new DOMParser().parseFromString(xml, "text/xml") as unknown as Parameters<typeof verifier.findSignatures>[0];
  const signatures = verifier.findSignatures(document);
  if (signatures.length !== 1) throw new Error("El XML debe contener exactamente una firma XMLDSig.");
  verifier.loadSignature(signatures[0]!);
  if (!verifier.checkSignature(xml)) throw new Error("Firma XMLDSig inválida.");
  return true;
}
