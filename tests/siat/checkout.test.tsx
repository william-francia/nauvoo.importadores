import { describe,it,expect,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../../src/lib/supabase",()=>({supabase:{functions:{invoke:vi.fn()}}}));
import { canalInicial,mensajeCheckout,confirmarVentaFiscal } from "../../src/features/ventas/services/checkout";
import { supabase } from "../../src/lib/supabase";
import ConfirmarVentaModal from "../../src/features/ventas/components/ConfirmarVentaModal";
import NuevoClienteModal from "../../src/features/ventas/components/NuevoClienteModal";
import {sendWhatsAppDocument} from "../../supabase/functions/_shared/siat/whatsapp-document";
const config={token:'synthetic',phoneId:'12345678',version:'v23.0',template:'factura_prueba',language:'es'};
describe('Checkout y entrega sin operaciones reales',()=>{
 it('selecciona canal sin obligar contactos',()=>{
  expect(canalInicial(null)).toBe('NINGUNO');expect(canalInicial({correo:'x@example.invalid'})).toBe('CORREO');
  expect(canalInicial({correo:'x@example.invalid',telefono:'+59170000000'})).toBe('WHATSAPP');
 });
 it('registro comercial permite ambos contactos vacios',()=>{
  const html=renderToStaticMarkup(<NuevoClienteModal abierto onCerrar={()=>{}} onClienteCreado={()=>{}}/>);
  expect(html).not.toMatch(/<input[^>]*required[^>]*type="(?:email|tel)"/);
  expect(html).toContain('Correo Electrónico (opcional)');
 });
 it('no dice emitida sin 908, transaccion y recepcion',()=>{
  const r={ventaId:'v',facturaId:'f',estadoFiscal:'VALIDADA',codigoEstado:908,transaccion:true,recepcionPersistida:true,entrega:'CONFIGURACION_PENDIENTE'};
  expect(mensajeCheckout(r)).toContain('emitida correctamente');
  expect(mensajeCheckout({...r,recepcionPersistida:false})).not.toContain('emitida correctamente');
  expect(mensajeCheckout({...r,transaccion:false})).not.toContain('emitida correctamente');
  expect(mensajeCheckout({...r,estadoFiscal:'SIN_RESPUESTA'})).toContain('No vuelva a registrar');
 });
 it('deshabilita confirmacion mientras procesa y muestra estado real',()=>{
  expect(renderToStaticMarkup(<ConfirmarVentaModal abierto procesando total="5" cliente="Sintetico" onCancelar={()=>{}}/>)).toMatch(/disabled=""[^>]*>Procesando/);
  expect(renderToStaticMarkup(<ConfirmarVentaModal abierto exitoso resultado="Venta registrada; fiscal pendiente" total="5" cliente="Sintetico" onCancelar={()=>{}}/>)).toContain('fiscal pendiente');
 });
 it('un timeout de checkout informa incertidumbre, no exito',async()=>{
  vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({data:null,error:new Error('timeout'),response:undefined});
  await expect(confirmarVentaFiscal({cliente_id:'x',metodo_pago:'EFECTIVO',tarjeta_ofuscada:null,descuento_venta:0,items:[]},{canal:'NINGUNO',destinatario:'',consentimiento:false},'id')).rejects.toThrow('Conserve la solicitud');
 });
 it('WhatsApp usa plantilla aprobada y PDF cargado, sin URL publica',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"id":"123456789"}')).mockResolvedValueOnce(new Response('{"messages":[{"id":"wamid.synthetic"}]}'));
  expect(await sendWhatsAppDocument(config,'+59170000000',new Uint8Array([1,2]),'factura.pdf',true,transport)).toBe('wamid.synthetic');
  expect(transport).toHaveBeenCalledTimes(2);
  const body=JSON.parse(String(transport.mock.calls[1][1]?.body));expect(body.type).toBe('template');
  expect(body.template.components[0].parameters[0].document.id).toBe('123456789');
 });
 it('WhatsApp bloquea sin consentimiento o proveedor',async()=>{
  const transport=vi.fn<typeof fetch>();
  await expect(sendWhatsAppDocument(config,'+59170000000',new Uint8Array(),'x.pdf',false,transport)).rejects.toThrow();
  await expect(sendWhatsAppDocument({...config,token:''},'+59170000000',new Uint8Array(),'x.pdf',true,transport)).rejects.toThrow();expect(transport).not.toHaveBeenCalled();
 });
 it('WhatsApp no repite solicitudes inciertas',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{"id":"123"}')).mockRejectedValueOnce(Error('timeout'));
  await expect(sendWhatsAppDocument(config,'+59170000000',new Uint8Array(),'x.pdf',true,transport)).rejects.toThrow('timeout');expect(transport).toHaveBeenCalledTimes(2);
 });
});
