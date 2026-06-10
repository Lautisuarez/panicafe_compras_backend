/**
 * AI-powered invoice parser. Sends the PDF to Anthropic's Claude with a tool
 * definition matching the same schema produced by the custom AFIP parser
 * (`utils/invoiceParser.js`), so the rest of the wizard (edit, match, save)
 * keeps working unchanged.
 *
 * The schema mirrors `parseInvoiceText`'s output:
 *   { comprobante, emisor, receptor, items[], totales, cae }
 *
 * Numeric fields are returned as strings in Argentinian format ("1.234,56")
 * because `matchHelpers.js` on the frontend already normalizes them with
 * `parseArgNumber`.
 */

const Anthropic = require("@anthropic-ai/sdk");

const DEFAULT_MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8192;
const TOOL_NAME = "submit_invoice";

class InvoiceAIError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InvoiceAIError";
    this.code = code;
  }
}

const invoiceToolSchema = {
  type: "object",
  properties: {
    comprobante: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          description:
            "Tipo de factura: 'A', 'B' o 'C'. Si no se puede determinar, devolver string vacío.",
        },
        codigo: {
          type: "string",
          description:
            "Código numérico del comprobante AFIP (ej. '001', '006'). Vacío si no aplica.",
        },
        puntoVenta: {
          type: "string",
          description:
            "Punto de venta de 5 dígitos con ceros a la izquierda (ej. '00001'). Vacío si no aplica.",
        },
        numero: {
          type: "string",
          description:
            "Número de comprobante de 8 dígitos con ceros a la izquierda (ej. '00003726'). Vacío si no aplica.",
        },
        fechaEmision: {
          type: "string",
          description:
            "Fecha de emisión en formato dd/mm/yyyy. Vacío si no se encuentra.",
        },
      },
      required: [
        "tipo",
        "codigo",
        "puntoVenta",
        "numero",
        "fechaEmision",
      ],
    },
    emisor: {
      type: "object",
      properties: {
        razonSocial: { type: "string" },
        cuit: {
          type: "string",
          description:
            "CUIT del emisor, exactamente 11 dígitos sin guiones. Vacío si no aplica.",
        },
        domicilio: { type: "string" },
        condicionIva: {
          type: "string",
          description:
            "Condición frente al IVA (ej. 'IVA Responsable Inscripto', 'Monotributo', 'Consumidor Final').",
        },
        ingresosBrutos: { type: "string" },
        inicioActividades: {
          type: "string",
          description:
            "Fecha de inicio de actividades en formato dd/mm/yyyy. Vacío si no aplica.",
        },
      },
      required: [
        "razonSocial",
        "cuit",
        "domicilio",
        "condicionIva",
        "ingresosBrutos",
        "inicioActividades",
      ],
    },
    receptor: {
      type: "object",
      properties: {
        razonSocial: { type: "string" },
        cuit: {
          type: "string",
          description:
            "CUIT del receptor, exactamente 11 dígitos sin guiones. Vacío si no aplica.",
        },
        domicilio: { type: "string" },
        condicionIva: { type: "string" },
        condicionVenta: {
          type: "string",
          description:
            "Condición de venta (ej. 'Contado', 'Cuenta Corriente', 'Tarjeta de Crédito').",
        },
      },
      required: [
        "razonSocial",
        "cuit",
        "domicilio",
        "condicionIva",
        "condicionVenta",
      ],
    },
    items: {
      type: "array",
      description:
        "Líneas/ítems de la factura. Una entrada por cada producto o servicio facturado.",
      items: {
        type: "object",
        properties: {
          producto: {
            type: "string",
            description: "Descripción del producto o servicio.",
          },
          cantidad: {
            type: "string",
            description:
              "Cantidad en formato argentino (ej. '1,00', '12,50'). Vacío si no aplica.",
          },
          unidadMedida: {
            type: "string",
            description:
              "Unidad de medida (ej. 'unidades', 'kg', 'litros'). Vacío si no aplica.",
          },
          precioUnitario: {
            type: "string",
            description:
              "Precio unitario en formato argentino con coma decimal (ej. '1.234,56'). Sin símbolo $.",
          },
          bonificacion: {
            type: "string",
            description:
              "Porcentaje de bonificación si existe (ej. '10,00'). Vacío si no aplica.",
          },
          subtotal: {
            type: "string",
            description:
              "Subtotal sin IVA del ítem en formato argentino. Vacío si no aplica.",
          },
          alicuotaIva: {
            type: "string",
            description:
              "Alícuota de IVA con símbolo de porcentaje (ej. '21%', '10.5%', '0%'). Vacío si no aplica.",
          },
          subtotalConIva: {
            type: "string",
            description:
              "Subtotal con IVA incluido en formato argentino. Vacío si no aplica.",
          },
        },
        required: [
          "producto",
          "cantidad",
          "unidadMedida",
          "precioUnitario",
          "bonificacion",
          "subtotal",
          "alicuotaIva",
          "subtotalConIva",
        ],
      },
    },
    totales: {
      type: "object",
      properties: {
        netoGravado: { type: "string" },
        iva27: { type: "string" },
        iva21: { type: "string" },
        iva105: {
          type: "string",
          description: "Monto de IVA al 10,5% en formato argentino.",
        },
        iva5: { type: "string" },
        iva25: {
          type: "string",
          description: "Monto de IVA al 2,5% en formato argentino.",
        },
        iva0: { type: "string" },
        otrosTributos: { type: "string" },
        total: { type: "string" },
      },
      required: [
        "netoGravado",
        "iva27",
        "iva21",
        "iva105",
        "iva5",
        "iva25",
        "iva0",
        "otrosTributos",
        "total",
      ],
    },
    cae: {
      type: "object",
      properties: {
        numero: {
          type: "string",
          description:
            "Número de CAE de 14 dígitos. Vacío si la factura no es electrónica AFIP.",
        },
        fechaVencimiento: {
          type: "string",
          description:
            "Fecha de vencimiento del CAE en formato dd/mm/yyyy. Vacío si no aplica.",
        },
      },
      required: ["numero", "fechaVencimiento"],
    },
  },
  required: ["comprobante", "emisor", "receptor", "items", "totales", "cae"],
};

const SYSTEM_PROMPT = `Sos un asistente experto en facturas argentinas. Recibís el PDF de una factura (puede tener cualquier formato, no necesariamente AFIP/ARCA) y tu tarea es extraer los datos relevantes y devolverlos llamando a la herramienta submit_invoice.

Reglas de extracción:
- Formato de fechas: siempre dd/mm/yyyy.
- Formato de números: argentino, con punto como separador de miles y coma decimal (ej. "1.234,56"). NO incluyas el símbolo "$".
- CUITs: solo 11 dígitos, sin guiones ni espacios.
- Punto de venta: 5 dígitos con ceros a la izquierda. Número de comprobante: 8 dígitos con ceros a la izquierda.
- Si un dato no aparece o no podés extraerlo con confianza, devolvé string vacío "". Nunca inventes valores.
- En los ítems, separá correctamente la cantidad del nombre del producto. Si la unidad de medida no es clara, usá "unidades".
- El array items debe contener una entrada por cada línea de producto/servicio facturado.
- Devolvé los totales tal cual figuran en la factura, sin recalcular.

Importante: respondé EXCLUSIVAMENTE invocando la herramienta submit_invoice con el objeto extraído. No incluyas texto adicional.`;

let _client = null;
function getClient(apiKey) {
  if (!_client) _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Parse an invoice PDF using Claude.
 * @param {Buffer} pdfBuffer Raw PDF bytes (from `multer` memory storage).
 * @returns {Promise<object>} Same schema as `parseInvoiceText`.
 * @throws {InvoiceAIError} With codes: MISSING_API_KEY, AI_REQUEST_FAILED, AI_NO_TOOL_USE.
 */
async function parseInvoiceWithAI(pdfBuffer) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new InvoiceAIError(
      "MISSING_API_KEY",
      "ANTHROPIC_API_KEY no está configurada"
    );
  }

  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    throw new InvoiceAIError(
      "AI_REQUEST_FAILED",
      "PDF buffer inválido o vacío"
    );
  }

  const client = getClient(apiKey);
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const base64Pdf = pdfBuffer.toString("base64");

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [
        {
          name: TOOL_NAME,
          description:
            "Devuelve los datos estructurados extraídos de la factura.",
          input_schema: invoiceToolSchema,
        },
      ],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Pdf,
              },
            },
            {
              type: "text",
              text: "Extrae los datos de esta factura llamando a la herramienta submit_invoice.",
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw new InvoiceAIError(
      "AI_REQUEST_FAILED",
      `Error al consultar Claude: ${err?.message || err}`
    );
  }

  const toolUseBlock = (response?.content || []).find(
    (block) => block?.type === "tool_use" && block?.name === TOOL_NAME
  );

  if (!toolUseBlock || !toolUseBlock.input) {
    throw new InvoiceAIError(
      "AI_NO_TOOL_USE",
      "La IA no devolvió la estructura esperada"
    );
  }

  return normalizeInvoicePayload(toolUseBlock.input);
}

/**
 * Defensive fill of every expected field so downstream consumers (frontend
 * forms, match step) never crash on `undefined` even if the model omits keys.
 */
function normalizeInvoicePayload(input) {
  const safeString = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const obj = input || {};
  const c = obj.comprobante || {};
  const e = obj.emisor || {};
  const r = obj.receptor || {};
  const t = obj.totales || {};
  const cae = obj.cae || {};
  const items = Array.isArray(obj.items) ? obj.items : [];

  return {
    comprobante: {
      tipo: safeString(c.tipo),
      codigo: safeString(c.codigo),
      puntoVenta: safeString(c.puntoVenta),
      numero: safeString(c.numero),
      fechaEmision: safeString(c.fechaEmision),
    },
    emisor: {
      razonSocial: safeString(e.razonSocial),
      cuit: safeString(e.cuit),
      domicilio: safeString(e.domicilio),
      condicionIva: safeString(e.condicionIva),
      ingresosBrutos: safeString(e.ingresosBrutos),
      inicioActividades: safeString(e.inicioActividades),
    },
    receptor: {
      razonSocial: safeString(r.razonSocial),
      cuit: safeString(r.cuit),
      domicilio: safeString(r.domicilio),
      condicionIva: safeString(r.condicionIva),
      condicionVenta: safeString(r.condicionVenta),
    },
    items: items.map((it) => ({
      producto: safeString(it?.producto),
      cantidad: safeString(it?.cantidad),
      unidadMedida: safeString(it?.unidadMedida),
      precioUnitario: safeString(it?.precioUnitario),
      bonificacion: safeString(it?.bonificacion),
      subtotal: safeString(it?.subtotal),
      alicuotaIva: safeString(it?.alicuotaIva),
      subtotalConIva: safeString(it?.subtotalConIva),
    })),
    totales: {
      netoGravado: safeString(t.netoGravado),
      iva27: safeString(t.iva27),
      iva21: safeString(t.iva21),
      iva105: safeString(t.iva105),
      iva5: safeString(t.iva5),
      iva25: safeString(t.iva25),
      iva0: safeString(t.iva0),
      otrosTributos: safeString(t.otrosTributos),
      total: safeString(t.total),
    },
    cae: {
      numero: safeString(cae.numero),
      fechaVencimiento: safeString(cae.fechaVencimiento),
    },
  };
}

module.exports = {
  parseInvoiceWithAI,
  InvoiceAIError,
};
