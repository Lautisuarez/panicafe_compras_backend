const db = require("../db/db");
const pdfParse = require("pdf-parse");
const parseInvoiceText = require("../utils/invoiceParser");
const { parseInvoiceWithAI, InvoiceAIError } = require("../utils/invoiceParserAI");
const {
  assertInvoiceStockReferences,
  assertNoDuplicateInvoice,
  insertStockImpuestosFromTemplate,
  insertStockComprobanteWithTemplate,
  insertStockMovimientoWithTemplate,
  fetchOpenBalanceIdForLocal,
  findIdProveedorByCuit,
} = require("../utils/invoiceStockMssql");

/** Marker recorded in StockComprobantes.observaciones for invoices ingested via the scanner flow. */
const SCANNED_INVOICE_OBSERVATION = "SCANEADA";

/**
 * Right-align legacy `prefijocomprobante` (char(4)) from a 5-digit AFIP "Punto de Venta"
 * (e.g. "00001"). Truncating from the left would erase the only meaningful digit.
 */
function buildPrefijoForLegacyDb(rawPrefijo, maxLen) {
  const digits = String(rawPrefijo ?? "").trim();
  if (!digits) {
    return "".padStart(maxLen, "0");
  }
  if (digits.length > maxLen) {
    return digits.slice(-maxLen);
  }
  return digits.padStart(maxLen, "0");
}

/** Locales allowed in the invoice scanning stock flow (num_local). */
const INVOICE_STOCK_LOCAL_NUMS = Object.freeze([1, 2, 15, 98]);

/** Legacy StockComprobantes string widths — trim to avoid error 8152 (truncation). */
const CPB_MAX = {
  tipocomprobante: 3,
  prefijocomprobante: 4,
  numerocomprobante: 8,
  observaciones: 200,
};

/** Sequelize SELECT: sometimes `[rows]`, sometimes `[rows, metadata]` — return `rows` only. */
function selectResultRows(result) {
  if (result == null) return [];
  if (!Array.isArray(result)) return [];
  if (result.length >= 1 && Array.isArray(result[0])) {
    return result[0];
  }
  return result;
}

/** After some SQL errors, the server has already ended the transaction; a second ROLLBACK raises 3903. */
async function safeRollbackSequelizeTransaction(transaction) {
  if (!transaction) {
    return;
  }
  try {
    await transaction.rollback();
  } catch (e) {
    const n = e?.parent?.number ?? e?.original?.number;
    const msg = String(e?.message ?? e?.parent?.message ?? "");
    if (n === 3903 || /no corresponding BEGIN TRANSACTION/i.test(msg)) {
      return;
    }
    throw e;
  }
}

const getInvoiceStockLocales = async (req, res) => {
  try {
    const sql = db.sequelizeInvoiceCatalog;
    const rows = selectResultRows(
      await sql.query(
        `SELECT num_local, RTRIM(nom_local) AS nom_local
         FROM MRCCENTRAL.dbo.locales
         WHERE num_local IN (1, 2, 15, 98)
         ORDER BY num_local`,
        { type: sql.QueryTypes.SELECT }
      )
    );
    res.json(
      rows.map((r) => ({
        id: r.num_local ?? r.NUM_LOCAL,
        nombre: String(r.nom_local ?? r.NOM_LOCAL ?? "").trim(),
      }))
    );
  } catch (error) {
    console.error("Error listando locales para facturas:", error);
    if (error.code === "SQL_DISABLED") {
      return res.status(503).json({ mensaje: "SQL Server no configurado." });
    }
    res.status(500).json({ mensaje: "Error al obtener locales" });
  }
};

const parseInvoicePdf = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ mensaje: "No se recibió ningún archivo" });
    }
    const data = await pdfParse(req.file.buffer);
    const parsed = parseInvoiceText(data.text);
    res.json(parsed);
  } catch (error) {
    console.error("Error parseando PDF:", error);
    res.status(500).json({ mensaje: "Error al procesar el PDF" });
  }
};

/**
 * Invoice scanning via Claude. Accepts any PDF (not necessarily AFIP/ARCA)
 * and returns the same schema as `parseInvoicePdf` so the rest of the wizard
 * keeps working unchanged.
 */
const parseInvoicePdfAI = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ mensaje: "No se recibió ningún archivo" });
    }
    const parsed = await parseInvoiceWithAI(req.file.buffer);
    res.json(parsed);
  } catch (error) {
    if (error instanceof InvoiceAIError) {
      if (error.code === "MISSING_API_KEY") {
        return res
          .status(503)
          .json({ mensaje: "Servicio de IA no configurado en el servidor" });
      }
      console.error("InvoiceAIError:", error.code, error.message);
      return res
        .status(502)
        .json({ mensaje: "Error al procesar el PDF con IA: " + error.message });
    }
    console.error("Error parseando PDF con IA:", error);
    res.status(500).json({ mensaje: "Error al procesar el PDF con IA" });
  }
};

const matchInvoiceItems = async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ mensaje: "Se requiere un array de items" });
    }

    const matches = [];
    for (let i = 0; i < items.length; i++) {
      const palabras = (items[i].producto || "")
        .split(/\s+/)
        .map((w) => w.toLowerCase().trim())
        .filter((w) => w.length > 2 && !/^\d+$/.test(w));

      if (palabras.length === 0) {
        matches.push({ itemIndex: i, producto: items[i].producto, sugerencias: [] });
        continue;
      }

      const whereClauses = palabras.map((_, idx) => `a.DESCRIP LIKE :word${idx}`);
      const replacements = {};
      palabras.forEach((w, idx) => {
        replacements[`word${idx}`] = `%${w}%`;
      });

      let rows = await db.sequelizeInvoiceCatalog.query(
        `SELECT TOP 5 a.CODIGO, a.DESCRIP, a.PRECIO
         FROM MRCCENTRAL.DBO.ARTICULO a
         WHERE a.INVISIBL = 0
           AND (${whereClauses.join(" AND ")})
         ORDER BY a.DESCRIP`,
        { replacements, type: db.sequelizeInvoiceCatalog.QueryTypes.SELECT }
      );

      if (rows.length === 0 && palabras.length > 1) {
        const primary = palabras.reduce((a, b) => {
          if (b.length > a.length) return b;
          if (b.length < a.length) return a;
          return a;
        });
        rows = await db.sequelizeInvoiceCatalog.query(
          `SELECT TOP 5 a.CODIGO, a.DESCRIP, a.PRECIO
           FROM MRCCENTRAL.DBO.ARTICULO a
           WHERE a.INVISIBL = 0
             AND a.DESCRIP LIKE :word0
           ORDER BY a.DESCRIP`,
          {
            replacements: { word0: `%${primary}%` },
            type: db.sequelizeInvoiceCatalog.QueryTypes.SELECT,
          }
        );
      }

      matches.push({
        itemIndex: i,
        producto: items[i].producto,
        sugerencias: rows.map((r) => ({
          codigo: parseInt(r.CODIGO, 10),
          descripcion: (r.DESCRIP || "").toString().trim(),
          precio: r.PRECIO,
        })),
      });
    }

    res.json({ matches });
  } catch (error) {
    console.error("Error en match de items:", error);
    if (error.code === "SQL_DISABLED") {
      return res.status(503).json({ mensaje: "SQL Server no configurado." });
    }
    res.status(500).json({ mensaje: "Error al buscar coincidencias de productos" });
  }
};

const saveInvoiceStock = async (req, res) => {
  const sql = db.sequelizeInvoiceCatalog;
  const t = await sql.transaction();
  try {
    const {
      comprobante,
      idproveedor: idproveedorRaw = 0,
      cuitProveedor,
      idlocal: idlocalRaw,
      iddeposito = 1,
      items,
      totales,
    } = req.body;

    if (!comprobante || !Array.isArray(items) || items.length === 0) {
      await safeRollbackSequelizeTransaction(t);
      return res.status(400).json({ mensaje: "Se requiere comprobante e items" });
    }

    const idlocalNum = Number(idlocalRaw);
    if (!Number.isFinite(idlocalNum) || !INVOICE_STOCK_LOCAL_NUMS.includes(idlocalNum)) {
      await safeRollbackSequelizeTransaction(t);
      return res.status(400).json({
        mensaje: "El local de destino no es valido para ingreso por factura.",
      });
    }

    let idproveedor = Number(idproveedorRaw) || 0;
    if (idproveedor <= 0) {
      idproveedor = await findIdProveedorByCuit(sql, t, cuitProveedor);
    }

    await assertInvoiceStockReferences(sql, t, {
      idlocal: idlocalNum,
      iddeposito,
      idproveedor,
      articuloCodigos: items.map((it) => it.articuloCodigo),
    });

    const idbalance = await fetchOpenBalanceIdForLocal(sql, t, idlocalNum);

    const tipoMap = { A: "FCA", B: "FCB", C: "FCC" };
    const tipoComprobante = tipoMap[comprobante.tipo] || comprobante.tipo || "FCA";
    const tipoSql = String(tipoComprobante).trim().slice(0, CPB_MAX.tipocomprobante);
    // Right-align prefix to the legacy char(4) column: AFIP "Punto de Venta" is 5 digits
    // (e.g. "00001") and `slice(0, 4)` would drop the only meaningful digit.
    const prefijoSql = buildPrefijoForLegacyDb(
      comprobante.prefijo,
      CPB_MAX.prefijocomprobante
    );
    const numeroSql = String(comprobante.numero ?? "")
      .trim()
      .slice(0, CPB_MAX.numerocomprobante);
    const userObs = String(comprobante.observaciones ?? "").trim();
    const observacionesSql = (
      userObs
        ? userObs.includes(SCANNED_INVOICE_OBSERVATION)
          ? userObs
          : `${userObs} ${SCANNED_INVOICE_OBSERVATION}`
        : SCANNED_INVOICE_OBSERVATION
    ).slice(0, CPB_MAX.observaciones);

    await assertNoDuplicateInvoice(sql, t, {
      tipoSql,
      prefijoSql,
      numeroSql,
      idproveedor,
    });

    const nextIdCpbRow = selectResultRows(
      await sql.query(
        `SELECT ISNULL(CAST(MAX(idcomprobante) AS DECIMAL(10, 0)), 0) + 1 AS n
         FROM MRCCENTRAL.dbo.StockComprobantes`,
        { type: sql.QueryTypes.SELECT, transaction: t }
      )
    );
    const nextIdComprobante = nextIdCpbRow[0]?.n ?? nextIdCpbRow[0]?.N;
    if (nextIdComprobante == null) {
      throw new Error("No se pudo calcular el siguiente idcomprobante");
    }

    // Full row: copy last IN+tipo template from DB, then override comprobante fields (all NOT NULL + triggers safe).
    const nextComprobanteIdk = await insertStockComprobanteWithTemplate(sql, t, {
      nextIdComprobante,
      comprobante,
      idproveedor,
      idlocal: idlocalNum,
      iddeposito,
      idbalance,
      tipoSql,
      prefijoSql,
      numeroSql,
      observacionesSql,
    });

    for (const item of items) {
      await insertStockMovimientoWithTemplate(sql, t, {
        comprobanteIdk: nextComprobanteIdk,
        item,
      });
    }

    await insertStockImpuestosFromTemplate(sql, t, nextComprobanteIdk, totales);

    await t.commit();
    res.status(201).json({
      mensaje: "Stock registrado correctamente",
      comprobanteIdk: nextComprobanteIdk,
      movimientos: items.length,
      idproveedor,
    });
  } catch (error) {
    await safeRollbackSequelizeTransaction(t);
    console.error("Error guardando stock:", error);
    if (error.statusCode === 409) {
      return res.status(409).json({ mensaje: error.message || "Factura duplicada" });
    }
    if (error.statusCode === 400) {
      return res.status(400).json({ mensaje: error.message || "Solicitud invalida" });
    }
    if (error.code === "SQL_DISABLED") {
      return res.status(503).json({ mensaje: "SQL Server no configurado." });
    }
    res.status(500).json({ mensaje: "Error al registrar el stock" });
  }
};

module.exports = {
  getInvoiceStockLocales,
  parseInvoicePdf,
  parseInvoicePdfAI,
  matchInvoiceItems,
  saveInvoiceStock,
};
