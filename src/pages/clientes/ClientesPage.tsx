import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import "./ClientesPage.css";

type ClientStatus = "habilitado" | "restringido";

type DocumentType =
  | "CI"
  | "CEX"
  | "NIT"
  | "PASAPORTE"
  | "OTRO";

interface Client {
  id: string;
  code: string;

  documentType: DocumentType;
  businessName: string;
  documentNumber: string;
  complement: string;

  email: string;
  phone: string;

  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
}

interface ClientForm {
  documentType: DocumentType;
  businessName: string;
  documentNumber: string;
  complement: string;
  email: string;
  phone: string;
}

const STORAGE_KEY = "ferreteria-francia-clientes";

const EMPTY_FORM: ClientForm = {
  documentType: "CI",
  businessName: "",
  documentNumber: "",
  complement: "",
  email: "",
  phone: "",
};

/* =========================================================
   CLIENTES
========================================================= */

export default function ClientesPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClients, setSelectedClients] = useState<string[]>([]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "todos" | ClientStatus
  >("todos");

  const [formOpen, setFormOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [editingClient, setEditingClient] =
    useState<Client | null>(null);

  const [viewingClient, setViewingClient] =
    useState<Client | null>(null);

  /*
   * Por ahora se carga desde localStorage.
   *
   * Más adelante esta parte será reemplazada por:
   *
   * const { data } = await supabase
   *   .from("clientes")
   *   .select("*");
   */

  useEffect(() => {
    try {
      const savedClients = localStorage.getItem(STORAGE_KEY);

      if (!savedClients) return;

      const parsedClients = JSON.parse(savedClients) as Client[];

      if (Array.isArray(parsedClients)) {
        setClients(parsedClients);
      }
    } catch (error) {
      console.error("No se pudieron cargar los clientes:", error);
    }
  }, []);

  /*
   * Persistencia temporal.
   */

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(clients),
    );
  }, [clients]);

  /* =========================================================
     FILTROS
  ========================================================= */

  const filteredClients = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return clients.filter((client) => {
      const matchesStatus =
        statusFilter === "todos" ||
        client.status === statusFilter;

      if (!matchesStatus) return false;

      if (!normalizedSearch) return true;

      return (
        client.code
          .toLowerCase()
          .includes(normalizedSearch) ||
        client.businessName
          .toLowerCase()
          .includes(normalizedSearch) ||
        client.documentNumber
          .toLowerCase()
          .includes(normalizedSearch) ||
        client.email
          .toLowerCase()
          .includes(normalizedSearch) ||
        client.phone
          .toLowerCase()
          .includes(normalizedSearch)
      );
    });
  }, [clients, search, statusFilter]);

  const allVisibleSelected =
    filteredClients.length > 0 &&
    filteredClients.every((client) =>
      selectedClients.includes(client.id),
    );

  /* =========================================================
     CREAR CLIENTE
  ========================================================= */

  function openCreateClient() {
    setEditingClient(null);
    setFormOpen(true);
  }

  function createClient(form: ClientForm) {
    const now = new Date().toISOString();

    const newClient: Client = {
      id: crypto.randomUUID(),

      code: generateClientCode(clients),

      documentType: form.documentType,
      businessName: form.businessName.trim(),
      documentNumber: form.documentNumber.trim(),
      complement: form.complement.trim(),

      email: form.email.trim(),
      phone: form.phone.trim(),

      status: "habilitado",

      createdAt: now,
      updatedAt: now,
    };

    setClients((previous) => [
      newClient,
      ...previous,
    ]);

    setFormOpen(false);
  }

  /* =========================================================
     EDITAR CLIENTE
  ========================================================= */

  function openEditClient(client: Client) {
    setEditingClient(client);
    setFormOpen(true);
  }

  function updateClient(form: ClientForm) {
    if (!editingClient) return;

    setClients((previous) =>
      previous.map((client) => {
        if (client.id !== editingClient.id) {
          return client;
        }

        return {
          ...client,

          documentType: form.documentType,
          businessName: form.businessName.trim(),
          documentNumber: form.documentNumber.trim(),
          complement: form.complement.trim(),

          email: form.email.trim(),
          phone: form.phone.trim(),

          updatedAt: new Date().toISOString(),
        };
      }),
    );

    setEditingClient(null);
    setFormOpen(false);
  }

  /* =========================================================
     VER CLIENTE
  ========================================================= */

  function openClientDetails(client: Client) {
    setViewingClient(client);
    setViewOpen(true);
  }

  /* =========================================================
     SELECCIÓN
  ========================================================= */

  function toggleClientSelection(clientId: string) {
    setSelectedClients((previous) => {
      if (previous.includes(clientId)) {
        return previous.filter(
          (id) => id !== clientId,
        );
      }

      return [...previous, clientId];
    });
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setSelectedClients((previous) =>
        previous.filter(
          (id) =>
            !filteredClients.some(
              (client) => client.id === id,
            ),
        ),
      );

      return;
    }

    setSelectedClients((previous) => {
      const newSelection = new Set(previous);

      filteredClients.forEach((client) => {
        newSelection.add(client.id);
      });

      return Array.from(newSelection);
    });
  }

  /* =========================================================
     RESTRINGIR / HABILITAR
  ========================================================= */

  function restrictSelectedClients() {
    if (selectedClients.length === 0) return;

    setClients((previous) =>
      previous.map((client) => {
        if (!selectedClients.includes(client.id)) {
          return client;
        }

        return {
          ...client,
          status: "restringido",
          updatedAt: new Date().toISOString(),
        };
      }),
    );

    setSelectedClients([]);
  }

  function enableSelectedClients() {
    if (selectedClients.length === 0) return;

    setClients((previous) =>
      previous.map((client) => {
        if (!selectedClients.includes(client.id)) {
          return client;
        }

        return {
          ...client,
          status: "habilitado",
          updatedAt: new Date().toISOString(),
        };
      }),
    );

    setSelectedClients([]);
  }

  /* =========================================================
     ELIMINAR
  ========================================================= */

  function requestDeleteSelected() {
    if (selectedClients.length === 0) return;

    setDeleteOpen(true);
  }

  function deleteSelectedClients() {
    setClients((previous) =>
      previous.filter(
        (client) =>
          !selectedClients.includes(client.id),
      ),
    );

    setSelectedClients([]);
    setDeleteOpen(false);
  }

  /* =========================================================
     RENDER
  ========================================================= */

  return (
    <div className="clients-page">
      {/* CABECERA */}

      <section className="clients-heading">
        <div>
          <div className="clients-breadcrumb">
            <HomeIcon />

            <span>Clientes</span>

            <ChevronRightIcon />

            <strong>Gestión de clientes</strong>
          </div>

          <h1>Gestión de Clientes</h1>

          <p>
            Administra la información de los clientes
            registrados en el sistema.
          </p>
        </div>

        <button
          className="clients-new-button"
          onClick={openCreateClient}
        >
          <UserPlusIcon />

          Nuevo cliente
        </button>
      </section>

      {/* CONTENEDOR */}

      <section className="clients-card">
        {/* TOOLBAR */}

        <div className="clients-toolbar">
          <div className="clients-bulk-actions">
            <button
              className="clients-action-button clients-action-danger"
              disabled={selectedClients.length === 0}
              onClick={requestDeleteSelected}
            >
              <TrashIcon />

              Eliminar
            </button>

            <button
              className="clients-action-button clients-action-restrict"
              disabled={selectedClients.length === 0}
              onClick={restrictSelectedClients}
            >
              <LockIcon />

              Restringir compras
            </button>

            <button
              className="clients-action-button clients-action-enable"
              disabled={selectedClients.length === 0}
              onClick={enableSelectedClients}
            >
              <UnlockIcon />

              Habilitar
            </button>

            {selectedClients.length > 0 && (
              <span className="clients-selected-count">
                {selectedClients.length} seleccionado
                {selectedClients.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="clients-filters">
            <div className="clients-search">
              <SearchIcon />

              <input
                type="text"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder="Buscar cliente..."
              />
            </div>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value as
                    | "todos"
                    | ClientStatus,
                )
              }
            >
              <option value="todos">
                Todos los estados
              </option>

              <option value="habilitado">
                Habilitados
              </option>

              <option value="restringido">
                Restringidos
              </option>
            </select>
          </div>
        </div>

        {/* TABLA */}

        <div className="clients-table-wrapper">
          <table className="clients-table">
            <thead>
              <tr>
                <th className="clients-actions-column">
                  Acciones
                </th>

                <th className="clients-checkbox-column">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="Seleccionar clientes"
                  />
                </th>

                <th>Código Cliente</th>
                <th>Razón Social</th>
                <th>Nro. Documento</th>
                <th>Correo</th>
                <th>Teléfono</th>
                <th>Tipo Documento</th>
                <th>Estado</th>
              </tr>
            </thead>

            <tbody>
              {filteredClients.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="clients-empty-cell"
                  >
                    <div className="clients-empty-state">
                      <div className="clients-empty-icon">
                        <UsersIcon />
                      </div>

                      <h3>
                        {clients.length === 0
                          ? "Todavía no existen clientes"
                          : "No encontramos coincidencias"}
                      </h3>

                      <p>
                        {clients.length === 0
                          ? "Registra tu primer cliente para comenzar."
                          : "Prueba utilizando otro criterio de búsqueda."}
                      </p>

                      {clients.length === 0 && (
                        <button
                          onClick={openCreateClient}
                        >
                          <UserPlusIcon />

                          Crear primer cliente
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredClients.map((client) => (
                  <tr
                    key={client.id}
                    className={
                      selectedClients.includes(client.id)
                        ? "clients-row-selected"
                        : ""
                    }
                  >
                    <td>
                      <div className="clients-row-actions">
                        {/* EDITAR */}

                        <button
                          className="clients-icon-button clients-edit"
                          onClick={() =>
                            openEditClient(client)
                          }
                          title="Editar cliente"
                          aria-label={`Editar ${client.businessName}`}
                        >
                          <EditLinesIcon />
                        </button>

                        {/* VER */}

                        <button
                          className="clients-icon-button clients-view"
                          onClick={() =>
                            openClientDetails(client)
                          }
                          title="Ver cliente"
                          aria-label={`Ver ${client.businessName}`}
                        >
                          <EyeIcon />
                        </button>
                      </div>
                    </td>

                    <td>
                      <input
                        type="checkbox"
                        checked={selectedClients.includes(
                          client.id,
                        )}
                        onChange={() =>
                          toggleClientSelection(
                            client.id,
                          )
                        }
                        aria-label={`Seleccionar ${client.businessName}`}
                      />
                    </td>

                    <td>
                      <strong className="clients-code">
                        {client.code}
                      </strong>
                    </td>

                    <td>{client.businessName}</td>

                    <td>
                      {client.documentNumber}

                      {client.complement && (
                        <span className="clients-complement">
                          {" "}
                          {client.complement}
                        </span>
                      )}
                    </td>

                    <td>{client.email || "—"}</td>

                    <td>{client.phone || "—"}</td>

                    <td>
                      <span className="clients-document-badge">
                        {getDocumentLabel(
                          client.documentType,
                        )}
                      </span>
                    </td>

                    <td>
                      <ClientStatusBadge
                        status={client.status}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* PIE */}

        <footer className="clients-table-footer">
          <span>
            Mostrando {filteredClients.length} de{" "}
            {clients.length} cliente
            {clients.length !== 1 ? "s" : ""}
          </span>
        </footer>
      </section>

      {/* FORMULARIO CREAR / EDITAR */}

      {formOpen && (
        <ClientFormModal
          client={editingClient}
          allClients={clients}
          onClose={() => {
            setFormOpen(false);
            setEditingClient(null);
          }}
          onCreate={createClient}
          onUpdate={updateClient}
        />
      )}

      {/* DETALLE */}

      {viewOpen && viewingClient && (
        <ClientDetailsModal
          client={viewingClient}
          onClose={() => {
            setViewOpen(false);
            setViewingClient(null);
          }}
          onEdit={() => {
            setViewOpen(false);
            openEditClient(viewingClient);
          }}
        />
      )}

      {/* CONFIRMAR ELIMINAR */}

      {deleteOpen && (
        <DeleteClientsModal
          amount={selectedClients.length}
          onClose={() => setDeleteOpen(false)}
          onConfirm={deleteSelectedClients}
        />
      )}
    </div>
  );
}

/* =========================================================
   FORMULARIO
========================================================= */

interface ClientFormModalProps {
  client: Client | null;
  allClients: Client[];

  onClose: () => void;
  onCreate: (form: ClientForm) => void;
  onUpdate: (form: ClientForm) => void;
}

function ClientFormModal({
  client,
  allClients,
  onClose,
  onCreate,
  onUpdate,
}: ClientFormModalProps) {
  const isEditing = Boolean(client);

  const [form, setForm] = useState<ClientForm>(
    client
      ? {
          documentType: client.documentType,
          businessName: client.businessName,
          documentNumber: client.documentNumber,
          complement: client.complement,
          email: client.email,
          phone: client.phone,
        }
      : EMPTY_FORM,
  );

  const [error, setError] = useState("");

  function updateField<K extends keyof ClientForm>(
    field: K,
    value: ClientForm[K],
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));

    setError("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const businessName = form.businessName.trim();
    const documentNumber =
      form.documentNumber.trim();
    const email = form.email.trim();

    if (!businessName) {
      setError(
        "Debes ingresar la razón social o nombre del cliente.",
      );
      return;
    }

    if (!documentNumber) {
      setError(
        "Debes ingresar el número de documento.",
      );
      return;
    }

    if (!email) {
      setError(
        "Debes ingresar el correo electrónico.",
      );
      return;
    }

    /*
     * Evitamos documentos duplicados.
     *
     * En edición ignoramos el cliente que estamos
     * modificando.
     */

    const duplicatedDocument =
      allClients.some(
        (existingClient) =>
          existingClient.documentNumber
            .trim()
            .toLowerCase() ===
            documentNumber.toLowerCase() &&
          existingClient.id !== client?.id,
      );

    if (duplicatedDocument) {
      setError(
        "Ya existe un cliente con ese número de documento.",
      );
      return;
    }

    if (isEditing) {
      onUpdate(form);
    } else {
      onCreate(form);
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="clients-modal clients-form-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <header className="clients-modal-header">
          <div>
            <span className="clients-modal-eyebrow">
              {isEditing
                ? "Gestión de clientes"
                : "Nuevo registro"}
            </span>

            <h2>
              {isEditing
                ? `Actualizar cliente ${client?.businessName ?? ""}`
                : "Registrar nuevo cliente"}
            </h2>
          </div>

          <button
            className="clients-modal-close"
            onClick={onClose}
            type="button"
            aria-label="Cerrar"
          >
            <CloseIcon />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="clients-modal-body">
            {error && (
              <div className="clients-form-error">
                <AlertIcon />

                {error}
              </div>
            )}

            <div className="clients-form-grid">
              {/* TIPO DOCUMENTO */}

              <label className="clients-field clients-field-full">
                <span>
                  Tipo Documento Identidad
                  <strong>*</strong>
                </span>

                <select
                  value={form.documentType}
                  onChange={(event) =>
                    updateField(
                      "documentType",
                      event.target
                        .value as DocumentType,
                    )
                  }
                  required
                >
                  <option value="CI">
                    CI - CÉDULA DE IDENTIDAD
                  </option>

                  <option value="CEX">
                    CEX - CÉDULA DE EXTRANJERO
                  </option>

                  <option value="NIT">
                    NIT
                  </option>

                  <option value="PASAPORTE">
                    PASAPORTE
                  </option>

                  <option value="OTRO">
                    OTRO DOCUMENTO
                  </option>
                </select>
              </label>

              {/* RAZÓN SOCIAL */}

              <label className="clients-field clients-field-full">
                <span>
                  Razón Social / Nombre
                  <strong>*</strong>
                </span>

                <input
                  type="text"
                  placeholder="Ej. Juan Pérez o Empresa S.R.L."
                  value={form.businessName}
                  onChange={(event) =>
                    updateField(
                      "businessName",
                      event.target.value,
                    )
                  }
                  autoFocus={!isEditing}
                  required
                />
              </label>

              {/* DOCUMENTO */}

              <label className="clients-field">
                <span>
                  Número Documento
                  <strong>*</strong>
                </span>

                <input
                  type="text"
                  placeholder="Número de documento"
                  value={form.documentNumber}
                  onChange={(event) =>
                    updateField(
                      "documentNumber",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>

              {/* COMPLEMENTO */}

              <label className="clients-field">
                <span>Complemento</span>

                <input
                  type="text"
                  placeholder="Ej. 1A"
                  value={form.complement}
                  onChange={(event) =>
                    updateField(
                      "complement",
                      event.target.value,
                    )
                  }
                />
              </label>

              {/* CORREO */}

              <label className="clients-field">
                <span>
                  Correo Electrónico
                  <strong>*</strong>
                </span>

                <input
                  type="email"
                  placeholder="cliente@correo.com"
                  value={form.email}
                  onChange={(event) =>
                    updateField(
                      "email",
                      event.target.value,
                    )
                  }
                  required
                />
              </label>

              {/* TELÉFONO */}

              <label className="clients-field">
                <span>Teléfonos</span>

                <input
                  type="tel"
                  placeholder="Ej. 70000000"
                  value={form.phone}
                  onChange={(event) =>
                    updateField(
                      "phone",
                      event.target.value,
                    )
                  }
                />
              </label>
            </div>

            {!isEditing && (
              <div className="clients-form-info">
                <InfoIcon />

                <div>
                  <strong>
                    El código del cliente se generará
                    automáticamente.
                  </strong>

                  <span>
                    El cliente quedará habilitado para
                    realizar compras.
                  </span>
                </div>
              </div>
            )}
          </div>

          <footer className="clients-modal-footer">
            <button
              type="button"
              className="clients-modal-cancel"
              onClick={onClose}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="clients-modal-save"
            >
              <SaveIcon />

              {isEditing
                ? "Guardar cambios"
                : "Guardar nuevo cliente"}
            </button>
          </footer>
        </form>
      </div>
    </ModalOverlay>
  );
}

/* =========================================================
   DETALLE DEL CLIENTE
========================================================= */

interface ClientDetailsModalProps {
  client: Client;
  onClose: () => void;
  onEdit: () => void;
}

function ClientDetailsModal({
  client,
  onClose,
  onEdit,
}: ClientDetailsModalProps) {
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="clients-modal clients-details-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <header className="clients-modal-header">
          <div>
            <span className="clients-modal-eyebrow">
              Información del cliente
            </span>

            <h2>{client.businessName}</h2>
          </div>

          <button
            className="clients-modal-close"
            onClick={onClose}
            type="button"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="clients-modal-body">
          <div className="clients-details-summary">
            <div className="clients-details-avatar">
              {getClientInitials(
                client.businessName,
              )}
            </div>

            <div>
              <h3>{client.businessName}</h3>

              <span>{client.code}</span>
            </div>

            <ClientStatusBadge
              status={client.status}
            />
          </div>

          <div className="clients-details-grid">
            <DetailItem
              label="Tipo de documento"
              value={getDocumentLabel(
                client.documentType,
              )}
            />

            <DetailItem
              label="Número de documento"
              value={`${client.documentNumber}${
                client.complement
                  ? ` ${client.complement}`
                  : ""
              }`}
            />

            <DetailItem
              label="Correo electrónico"
              value={client.email || "Sin correo"}
            />

            <DetailItem
              label="Teléfono"
              value={client.phone || "Sin teléfono"}
            />

            <DetailItem
              label="Fecha de creación"
              value={formatDateTime(
                client.createdAt,
              )}
            />

            <DetailItem
              label="Última actualización"
              value={formatDateTime(
                client.updatedAt,
              )}
            />
          </div>

          {client.status === "restringido" && (
            <div className="clients-restricted-warning">
              <LockIcon />

              <div>
                <strong>
                  Cliente con compras restringidas
                </strong>

                <span>
                  Actualmente este cliente no debería
                  poder completar nuevas ventas.
                </span>
              </div>
            </div>
          )}
        </div>

        <footer className="clients-modal-footer">
          <button
            type="button"
            className="clients-modal-cancel"
            onClick={onClose}
          >
            Cerrar
          </button>

          <button
            type="button"
            className="clients-modal-save"
            onClick={onEdit}
          >
            <EditLinesIcon />

            Editar cliente
          </button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="clients-detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/* =========================================================
   ELIMINAR
========================================================= */

function DeleteClientsModal({
  amount,
  onClose,
  onConfirm,
}: {
  amount: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="clients-modal clients-delete-modal"
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        <div className="clients-delete-icon">
          <TrashIcon />
        </div>

        <h2>
          ¿Eliminar{" "}
          {amount === 1
            ? "este cliente"
            : "estos clientes"}
          ?
        </h2>

        <p>
          Se eliminarán {amount} registro
          {amount !== 1 ? "s" : ""} de la gestión
          de clientes.
        </p>

        <div className="clients-delete-warning">
          Esta acción no puede deshacerse.
        </div>

        <footer className="clients-delete-actions">
          <button
            className="clients-modal-cancel"
            onClick={onClose}
          >
            Cancelar
          </button>

          <button
            className="clients-confirm-delete"
            onClick={onConfirm}
          >
            <TrashIcon />

            Eliminar
          </button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

/* =========================================================
   MODAL OVERLAY
========================================================= */

function ModalOverlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="clients-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

/* =========================================================
   ESTADO
========================================================= */

function ClientStatusBadge({
  status,
}: {
  status: ClientStatus;
}) {
  if (status === "restringido") {
    return (
      <span className="clients-status clients-status-restricted">
        <span></span>
        Restringido
      </span>
    );
  }

  return (
    <span className="clients-status clients-status-enabled">
      <span></span>
      Habilitado
    </span>
  );
}

/* =========================================================
   HELPERS
========================================================= */

function generateClientCode(
  clients: Client[],
) {
  let highestNumber = 0;

  clients.forEach((client) => {
    const numericPart = Number(
      client.code.replace(/\D/g, ""),
    );

    if (
      Number.isFinite(numericPart) &&
      numericPart > highestNumber
    ) {
      highestNumber = numericPart;
    }
  });

  return `CLI-${String(
    highestNumber + 1,
  ).padStart(6, "0")}`;
}

function getDocumentLabel(
  type: DocumentType,
) {
  const labels: Record<DocumentType, string> = {
    CI: "CI - CÉDULA DE IDENTIDAD",
    CEX: "CEX - CÉDULA DE EXTRANJERO",
    NIT: "NIT",
    PASAPORTE: "PASAPORTE",
    OTRO: "OTRO DOCUMENTO",
  };

  return labels[type];
}

function formatDateTime(date: string) {
  return new Intl.DateTimeFormat("es-BO", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(date));
}

function getClientInitials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "CL";

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

/* =========================================================
   ICONOS
========================================================= */

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="m9 18 6-6-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UserPlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="9"
        cy="8"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 8v6M14 11h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="11"
        cy="11"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="m20 20-4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <circle
        cx="12"
        cy="12"
        r="2.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function EditLinesIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M4 6h10M4 12h7M4 18h10M15 14l5-5M17 7l2 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M8 10V7a4 4 0 0 1 8 0v3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect
        x="5"
        y="10"
        width="14"
        height="10"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M8 10V7a4 4 0 0 1 7.5-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M6 6l12 12M18 6 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M12 3 2.5 20h19z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />

      <path
        d="M12 9v5M12 17.3v.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M12 11v6M12 7.5v.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="9"
        cy="8"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.8M17 14c2.3.7 4 2.8 4 5.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

