-- Cuenta de usuario, roles y autorización granular.
-- Reutiliza public.usuarios como perfil; las credenciales permanecen en Supabase Auth.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_roles (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text NOT NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_roles_code_format CHECK (code ~ '^[a-z_]+$')
);

CREATE TABLE IF NOT EXISTS public.app_permissions (
  code text PRIMARY KEY,
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_permissions_code_format CHECK (code ~ '^[a-z_]+\.[a-z_]+$')
);

CREATE TABLE IF NOT EXISTS public.app_role_permissions (
  role_code text NOT NULL REFERENCES public.app_roles(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.app_permissions(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO public.app_roles (code, label, description) VALUES
  ('administrador', 'Administrador', 'Acceso total al sistema.'),
  ('vendedor', 'Vendedor', 'Gestión comercial de ventas y clientes.'),
  ('almacen', 'Almacén', 'Gestión de productos, stock y movimientos.'),
  ('caja', 'Caja', 'Gestión de cobros, ventas y facturación.')
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, description = EXCLUDED.description;

INSERT INTO public.app_permissions (code, module, action, description) VALUES
  ('products.read', 'products', 'read', 'Consultar productos.'),
  ('products.create', 'products', 'create', 'Crear productos.'),
  ('products.update', 'products', 'update', 'Editar productos.'),
  ('products.delete', 'products', 'delete', 'Eliminar productos.'),
  ('inventory.read', 'inventory', 'read', 'Consultar inventario.'),
  ('inventory.update', 'inventory', 'update', 'Gestionar existencias.'),
  ('clients.read', 'clients', 'read', 'Consultar clientes.'),
  ('clients.create', 'clients', 'create', 'Crear clientes.'),
  ('clients.update', 'clients', 'update', 'Editar clientes.'),
  ('clients.delete', 'clients', 'delete', 'Eliminar clientes.'),
  ('sales.read', 'sales', 'read', 'Consultar ventas.'),
  ('sales.create', 'sales', 'create', 'Registrar ventas.'),
  ('sales.update', 'sales', 'update', 'Editar ventas permitidas.'),
  ('sales.complete', 'sales', 'complete', 'Completar ventas.'),
  ('sales.delete', 'sales', 'delete', 'Eliminar ventas.'),
  ('sales_detail.read', 'sales_detail', 'read', 'Consultar detalle de ventas.'),
  ('sales_detail.update', 'sales_detail', 'update', 'Editar detalle de ventas pendientes.'),
  ('movements.read', 'movements', 'read', 'Consultar movimientos de inventario.'),
  ('movements.create', 'movements', 'create', 'Registrar movimientos de inventario.'),
  ('movements.update', 'movements', 'update', 'Editar movimientos de inventario.'),
  ('movements.delete', 'movements', 'delete', 'Eliminar movimientos de inventario.'),
  ('invoices.read', 'invoices', 'read', 'Consultar facturación SIAT.'),
  ('invoices.create', 'invoices', 'create', 'Preparar facturación.'),
  ('invoices.issue', 'invoices', 'issue', 'Emitir y procesar facturas.'),
  ('history.read', 'history', 'read', 'Consultar historial y reportes.'),
  ('users.read', 'users', 'read', 'Consultar usuarios.'),
  ('users.create', 'users', 'create', 'Crear usuarios.'),
  ('users.update', 'users', 'update', 'Editar usuarios y roles.'),
  ('users.disable', 'users', 'disable', 'Activar o desactivar usuarios.')
ON CONFLICT (code) DO UPDATE SET module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description;

INSERT INTO public.app_role_permissions (role_code, permission_code)
SELECT seeded.role_code, seeded.permission_code
FROM (VALUES
  ('administrador', 'products.read'), ('administrador', 'products.create'), ('administrador', 'products.update'), ('administrador', 'products.delete'),
  ('administrador', 'inventory.read'), ('administrador', 'inventory.update'),
  ('administrador', 'clients.read'), ('administrador', 'clients.create'), ('administrador', 'clients.update'), ('administrador', 'clients.delete'),
  ('administrador', 'sales.read'), ('administrador', 'sales.create'), ('administrador', 'sales.update'), ('administrador', 'sales.complete'), ('administrador', 'sales.delete'),
  ('administrador', 'sales_detail.read'), ('administrador', 'sales_detail.update'),
  ('administrador', 'movements.read'), ('administrador', 'movements.create'), ('administrador', 'movements.update'), ('administrador', 'movements.delete'),
  ('administrador', 'invoices.read'), ('administrador', 'invoices.create'), ('administrador', 'invoices.issue'), ('administrador', 'history.read'),
  ('administrador', 'users.read'), ('administrador', 'users.create'), ('administrador', 'users.update'), ('administrador', 'users.disable'),
  ('vendedor', 'products.read'), ('vendedor', 'inventory.read'),
  ('vendedor', 'clients.read'), ('vendedor', 'clients.create'), ('vendedor', 'clients.update'),
  ('vendedor', 'sales.read'), ('vendedor', 'sales.create'), ('vendedor', 'sales.update'), ('vendedor', 'sales.complete'),
  ('vendedor', 'sales_detail.read'), ('vendedor', 'sales_detail.update'), ('vendedor', 'movements.read'),
  ('vendedor', 'invoices.read'), ('vendedor', 'invoices.create'), ('vendedor', 'history.read'),
  ('almacen', 'products.read'), ('almacen', 'products.create'), ('almacen', 'products.update'),
  ('almacen', 'inventory.read'), ('almacen', 'inventory.update'), ('almacen', 'clients.read'), ('almacen', 'sales.read'),
  ('almacen', 'sales_detail.read'), ('almacen', 'movements.read'), ('almacen', 'movements.create'), ('almacen', 'movements.update'),
  ('almacen', 'history.read'),
  ('caja', 'products.read'), ('caja', 'inventory.read'),
  ('caja', 'clients.read'), ('caja', 'clients.create'), ('caja', 'clients.update'),
  ('caja', 'sales.read'), ('caja', 'sales.create'), ('caja', 'sales.update'), ('caja', 'sales.complete'),
  ('caja', 'sales_detail.read'), ('caja', 'movements.read'),
  ('caja', 'invoices.read'), ('caja', 'invoices.create'), ('caja', 'invoices.issue'), ('caja', 'history.read')
) AS seeded(role_code, permission_code)
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- Mantiene la matriz exacta incluso si esta migración se reutiliza sobre datos sembrados previamente.
DELETE FROM public.app_role_permissions
WHERE (role_code, permission_code) IN (
  ('almacen', 'products.delete'),
  ('almacen', 'movements.delete')
);

UPDATE public.usuarios
SET rol = CASE lower(trim(rol))
  WHEN 'admin' THEN 'administrador'
  WHEN 'administrador' THEN 'administrador'
  WHEN 'vendedor' THEN 'vendedor'
  WHEN 'almacén' THEN 'almacen'
  WHEN 'almacen' THEN 'almacen'
  WHEN 'caja' THEN 'caja'
  ELSE lower(trim(rol))
END;

-- Vincula perfiles históricos solo cuando el correo identifica una única fila.
UPDATE public.usuarios AS profile
SET auth_user_id = auth_user.id,
    correo = COALESCE(profile.correo, auth_user.email),
    updated_at = now()
FROM auth.users AS auth_user
WHERE profile.auth_user_id IS NULL
  AND profile.correo IS NOT NULL
  AND auth_user.email IS NOT NULL
  AND lower(profile.correo) = lower(auth_user.email)
  AND (SELECT count(*) FROM public.usuarios AS candidate WHERE lower(candidate.correo) = lower(profile.correo)) = 1
  AND NOT EXISTS (SELECT 1 FROM public.usuarios AS linked WHERE linked.auth_user_id = auth_user.id);

-- Garantiza que la cuenta administrativa existente quede vinculada y activa.
-- Si no tenía perfil de negocio, lo crea sin modificar sus credenciales de Auth.
INSERT INTO public.usuarios (
  auth_user_id, nombre, apellidos, tipo_documento, numero_documento, correo, rol, activo
)
SELECT
  auth_user.id,
  COALESCE(nullif(trim(auth_user.raw_user_meta_data->>'nombre'), ''), 'Administrador'),
  COALESCE(nullif(trim(auth_user.raw_user_meta_data->>'apellidos'), ''), 'Sistema'),
  'OTRO',
  'AUTH-' || auth_user.id::text,
  auth_user.email,
  'administrador',
  true
FROM auth.users AS auth_user
WHERE lower(auth_user.email) = 'admin@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.usuarios AS profile WHERE profile.auth_user_id = auth_user.id
  )
ON CONFLICT (auth_user_id) DO NOTHING;

UPDATE public.usuarios AS profile
SET rol = 'administrador', activo = true, updated_at = now()
FROM auth.users AS auth_user
WHERE auth_user.id = profile.auth_user_id
  AND lower(auth_user.email) = 'admin@gmail.com';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_app_fk') THEN
    ALTER TABLE public.usuarios
      ADD CONSTRAINT usuarios_rol_app_fk FOREIGN KEY (rol) REFERENCES public.app_roles(code) NOT VALID;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_has_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios AS profile
    JOIN public.app_role_permissions AS assigned ON assigned.role_code = profile.rol
    WHERE profile.auth_user_id = auth.uid()
      AND profile.activo = true
      AND assigned.permission_code = p_permission
  );
$$;

CREATE OR REPLACE FUNCTION public.mis_permisos()
RETURNS TABLE(permission text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT assigned.permission_code
  FROM public.usuarios AS profile
  JOIN public.app_role_permissions AS assigned ON assigned.role_code = profile.rol
  WHERE profile.auth_user_id = auth.uid() AND profile.activo = true
  ORDER BY assigned.permission_code;
$$;

CREATE OR REPLACE FUNCTION public.matriz_permisos()
RETURNS TABLE(role_code text, role_label text, permission text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role.code, role.label, assigned.permission_code
  FROM public.app_roles AS role
  LEFT JOIN public.app_role_permissions AS assigned ON assigned.role_code = role.code
  WHERE EXISTS (
    SELECT 1 FROM public.usuarios AS profile
    WHERE profile.auth_user_id = auth.uid() AND profile.activo = true
  )
  ORDER BY role.code, assigned.permission_code;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_mi_perfil(p_nombre text, p_apellidos text, p_telefono text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'La sesión no es válida.'; END IF;
  IF length(trim(coalesce(p_nombre, ''))) < 2 OR length(trim(coalesce(p_apellidos, ''))) < 2 THEN
    RAISE EXCEPTION 'El nombre y los apellidos deben tener al menos 2 caracteres.';
  END IF;
  IF length(trim(coalesce(p_nombre, ''))) > 80 OR length(trim(coalesce(p_apellidos, ''))) > 120 THEN
    RAISE EXCEPTION 'El nombre o los apellidos superan la longitud permitida.';
  END IF;
  IF p_telefono IS NOT NULL AND length(trim(p_telefono)) > 30 THEN
    RAISE EXCEPTION 'El teléfono no puede superar 30 caracteres.';
  END IF;

  UPDATE public.usuarios
  SET nombre = trim(p_nombre),
      apellidos = trim(p_apellidos),
      telefono = nullif(trim(coalesce(p_telefono, '')), ''),
      updated_at = now()
  WHERE auth_user_id = auth.uid() AND activo = true;

  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un perfil activo asociado a la sesión.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.administrar_acceso_usuario(p_usuario_id uuid, p_rol text, p_activo boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_has_permission('users.update') THEN
    RAISE EXCEPTION 'No tiene permisos para administrar usuarios.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.app_roles WHERE code = lower(trim(p_rol))) THEN
    RAISE EXCEPTION 'El rol indicado no existe.';
  END IF;
  IF p_activo = false AND NOT public.app_has_permission('users.disable') THEN
    RAISE EXCEPTION 'No tiene permisos para desactivar usuarios.';
  END IF;

  UPDATE public.usuarios
  SET rol = lower(trim(p_rol)), activo = p_activo, updated_at = now()
  WHERE id = p_usuario_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuario no encontrado.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_perfil_usuario_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Reutiliza un perfil precargado (incluido el administrador histórico) cuando
  -- el correo identifica una única fila, evitando duplicar usuarios de negocio.
  UPDATE public.usuarios AS profile
  SET auth_user_id = NEW.id,
      correo = COALESCE(profile.correo, NEW.email),
      updated_at = now()
  WHERE profile.auth_user_id IS NULL
    AND NEW.email IS NOT NULL
    AND profile.correo IS NOT NULL
    AND lower(profile.correo) = lower(NEW.email)
    AND (SELECT count(*) FROM public.usuarios AS candidate WHERE lower(candidate.correo) = lower(NEW.email)) = 1;

  IF FOUND THEN RETURN NEW; END IF;

  INSERT INTO public.usuarios (
    auth_user_id, nombre, apellidos, tipo_documento, numero_documento, correo, rol, activo
  ) VALUES (
    NEW.id,
    COALESCE(nullif(trim(NEW.raw_user_meta_data->>'nombre'), ''), nullif(split_part(COALESCE(NEW.email, ''), '@', 1), ''), 'Usuario'),
    COALESCE(nullif(trim(NEW.raw_user_meta_data->>'apellidos'), ''), ''),
    'OTRO',
    'AUTH-' || NEW.id::text,
    NEW.email,
    'vendedor',
    true
  )
  ON CONFLICT (auth_user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_public_usuario ON auth.users;
CREATE TRIGGER on_auth_user_created_public_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.crear_perfil_usuario_auth();

REVOKE ALL ON FUNCTION public.app_has_permission(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mis_permisos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.matriz_permisos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.actualizar_mi_perfil(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.administrar_acceso_usuario(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_perfil_usuario_auth() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_has_permission(text), public.mis_permisos(), public.matriz_permisos(), public.actualizar_mi_perfil(text, text, text), public.administrar_acceso_usuario(uuid, text, boolean) TO authenticated;

ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_roles_read ON public.app_roles;
DROP POLICY IF EXISTS app_permissions_read ON public.app_permissions;
DROP POLICY IF EXISTS app_role_permissions_read ON public.app_role_permissions;
CREATE POLICY app_roles_read ON public.app_roles FOR SELECT TO authenticated USING (public.app_has_permission('products.read'));
CREATE POLICY app_permissions_read ON public.app_permissions FOR SELECT TO authenticated USING (public.app_has_permission('products.read'));
CREATE POLICY app_role_permissions_read ON public.app_role_permissions FOR SELECT TO authenticated USING (public.app_has_permission('products.read'));

DROP POLICY IF EXISTS acceso_total_autenticados ON public.almacenes;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.clientes;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.detalle_ventas;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.historial_ventas;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.movimientos_inventario;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.productos;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.stock_por_almacen;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.usuarios;
DROP POLICY IF EXISTS acceso_total_autenticados ON public.ventas;

CREATE POLICY almacenes_read ON public.almacenes FOR SELECT TO authenticated USING (public.app_has_permission('inventory.read'));
CREATE POLICY almacenes_manage ON public.almacenes FOR ALL TO authenticated USING (public.app_has_permission('users.update')) WITH CHECK (public.app_has_permission('users.update'));
CREATE POLICY clientes_read ON public.clientes FOR SELECT TO authenticated USING (public.app_has_permission('clients.read'));
CREATE POLICY clientes_create ON public.clientes FOR INSERT TO authenticated WITH CHECK (public.app_has_permission('clients.create'));
CREATE POLICY clientes_update ON public.clientes FOR UPDATE TO authenticated USING (public.app_has_permission('clients.update')) WITH CHECK (public.app_has_permission('clients.update'));
CREATE POLICY clientes_delete ON public.clientes FOR DELETE TO authenticated USING (public.app_has_permission('clients.delete'));
CREATE POLICY productos_read ON public.productos FOR SELECT TO authenticated USING (public.app_has_permission('products.read'));
CREATE POLICY productos_create ON public.productos FOR INSERT TO authenticated WITH CHECK (public.app_has_permission('products.create'));
CREATE POLICY productos_update ON public.productos FOR UPDATE TO authenticated USING (public.app_has_permission('products.update')) WITH CHECK (public.app_has_permission('products.update'));
CREATE POLICY productos_delete ON public.productos FOR DELETE TO authenticated USING (public.app_has_permission('products.delete'));
CREATE POLICY stock_read ON public.stock_por_almacen FOR SELECT TO authenticated USING (public.app_has_permission('inventory.read'));
CREATE POLICY stock_manage ON public.stock_por_almacen FOR ALL TO authenticated USING (public.app_has_permission('inventory.update')) WITH CHECK (public.app_has_permission('inventory.update'));
CREATE POLICY movimientos_read ON public.movimientos_inventario FOR SELECT TO authenticated USING (public.app_has_permission('movements.read'));
CREATE POLICY movimientos_create ON public.movimientos_inventario FOR INSERT TO authenticated WITH CHECK (public.app_has_permission('movements.create'));
CREATE POLICY movimientos_update ON public.movimientos_inventario FOR UPDATE TO authenticated USING (public.app_has_permission('movements.update')) WITH CHECK (public.app_has_permission('movements.update'));
CREATE POLICY movimientos_delete ON public.movimientos_inventario FOR DELETE TO authenticated USING (public.app_has_permission('movements.delete'));
CREATE POLICY ventas_read ON public.ventas FOR SELECT TO authenticated USING (public.app_has_permission('sales.read'));
CREATE POLICY ventas_update ON public.ventas FOR UPDATE TO authenticated
  USING (public.app_has_permission('sales.update'))
  WITH CHECK (
    public.app_has_permission('sales.update')
    AND CASE estado
      WHEN 'pendiente' THEN true
      WHEN 'confirmada' THEN public.app_has_permission('sales.complete')
      WHEN 'facturada' THEN public.app_has_permission('invoices.issue')
      WHEN 'anulada' THEN public.app_has_permission('sales.delete') OR public.app_has_permission('invoices.issue')
      ELSE false
    END
  );
CREATE POLICY ventas_delete ON public.ventas FOR DELETE TO authenticated USING (public.app_has_permission('sales.delete'));
CREATE POLICY detalle_ventas_read ON public.detalle_ventas FOR SELECT TO authenticated USING (public.app_has_permission('sales_detail.read'));
CREATE POLICY detalle_ventas_update_pending ON public.detalle_ventas FOR UPDATE TO authenticated
  USING (public.app_has_permission('sales_detail.update') AND EXISTS (SELECT 1 FROM public.ventas WHERE ventas.id = detalle_ventas.venta_id AND ventas.estado = 'pendiente'))
  WITH CHECK (public.app_has_permission('sales_detail.update') AND EXISTS (SELECT 1 FROM public.ventas WHERE ventas.id = detalle_ventas.venta_id AND ventas.estado = 'pendiente'));
CREATE POLICY historial_read ON public.historial_ventas FOR SELECT TO authenticated USING (public.app_has_permission('history.read'));
CREATE POLICY usuarios_read_own ON public.usuarios FOR SELECT TO authenticated USING (auth_user_id = auth.uid());
CREATE POLICY usuarios_read_admin ON public.usuarios FOR SELECT TO authenticated USING (public.app_has_permission('users.read'));

DROP POLICY IF EXISTS facturas_siat_lectura_operativa ON public.facturas_siat;
DROP POLICY IF EXISTS facturas_siat_lectura_por_permiso ON public.facturas_siat;
CREATE POLICY facturas_siat_lectura_por_permiso ON public.facturas_siat FOR SELECT TO authenticated USING (public.app_has_permission('invoices.read'));

-- Centraliza las comprobaciones administrativas históricas en el nuevo modelo.
CREATE OR REPLACE FUNCTION public.siat_es_administrador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_has_permission('users.update');
$$;

-- Las lecturas SIAT que antes estaban abiertas a cualquier usuario autenticado
-- ahora requieren permiso explícito de facturación.
DO $$
DECLARE
  nombre_tabla text;
BEGIN
  FOREACH nombre_tabla IN ARRAY ARRAY[
    'siat_configuracion', 'siat_sucursales', 'siat_puntos_venta', 'siat_terminales',
    'siat_cuis', 'siat_cufd', 'siat_catalogos', 'siat_catalogo_items',
    'siat_sincronizaciones', 'siat_producto_homologaciones', 'siat_eventos_significativos',
    'siat_paquetes', 'siat_paquete_facturas', 'siat_entregas_documentos'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', nombre_tabla || '_lectura', nombre_tabla);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', nombre_tabla || '_lectura_por_permiso', nombre_tabla);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_has_permission(''invoices.read''))',
      nombre_tabla || '_lectura_por_permiso', nombre_tabla
    );
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS siat_metodo_pago_mapeos_lectura ON public.siat_metodo_pago_mapeos;
CREATE POLICY siat_metodo_pago_mapeos_lectura_por_permiso ON public.siat_metodo_pago_mapeos
  FOR SELECT TO authenticated USING (public.app_has_permission('invoices.read'));
DROP POLICY IF EXISTS siat_artefactos_lectura ON public.siat_artefactos_oficiales;
CREATE POLICY siat_artefactos_lectura_por_permiso ON public.siat_artefactos_oficiales
  FOR SELECT TO authenticated USING (public.app_has_permission('invoices.read'));
DROP POLICY IF EXISTS siat_reglas_lectura ON public.siat_reglas_normativas;
CREATE POLICY siat_reglas_lectura_por_permiso ON public.siat_reglas_normativas
  FOR SELECT TO authenticated USING (public.app_has_permission('invoices.read'));
DROP POLICY IF EXISTS siat_estado_operativo_lectura ON public.siat_estado_operativo;
CREATE POLICY siat_estado_operativo_lectura_por_permiso ON public.siat_estado_operativo
  FOR SELECT TO authenticated USING (public.app_has_permission('invoices.read'));

REVOKE INSERT, UPDATE, DELETE ON public.usuarios FROM authenticated;
GRANT SELECT ON public.usuarios, public.app_roles, public.app_permissions, public.app_role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.almacenes, public.clientes, public.detalle_ventas, public.historial_ventas, public.movimientos_inventario, public.productos, public.stock_por_almacen, public.ventas TO authenticated;

-- El RPC público de venta usa SECURITY DEFINER; esta comprobación impide saltarse RLS.
CREATE OR REPLACE FUNCTION public.registrar_venta_fiscal(
  p_cliente_id uuid,
  p_metodo_pago text,
  p_observacion text,
  p_descuento_venta numeric,
  p_tarjeta_ofuscada text,
  p_items jsonb
)
RETURNS TABLE (venta_id uuid, codigo_venta text, total numeric, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.app_has_permission('sales.create') THEN
    RAISE EXCEPTION 'No tiene permisos para registrar ventas.';
  END IF;
  IF p_metodo_pago = 'TARJETA' AND COALESCE(p_tarjeta_ofuscada, '') !~ '^[0-9]{4}0{8}[0-9]{4}$' THEN
    RAISE EXCEPTION 'La tarjeta debe conservar únicamente los primeros y últimos cuatro dígitos, con ceros al medio.';
  END IF;
  IF p_metodo_pago <> 'TARJETA' AND p_tarjeta_ofuscada IS NOT NULL THEN
    RAISE EXCEPTION 'El número de tarjeta solo corresponde al método de pago Tarjeta.';
  END IF;
  PERFORM set_config('app.siat_tarjeta_ofuscada', COALESCE(p_tarjeta_ofuscada, ''), true);
  RETURN QUERY SELECT * FROM public.registrar_venta(p_cliente_id, p_metodo_pago, p_observacion, p_descuento_venta, p_items);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.registrar_venta(uuid, text, text, numeric, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_venta_fiscal(uuid, text, text, numeric, text, jsonb) TO authenticated;

COMMIT;
