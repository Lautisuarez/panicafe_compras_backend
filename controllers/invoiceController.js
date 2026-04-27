const db = require("../db/db");
const pdfParse = require("pdf-parse");
const parseInvoiceText = require("../utils/invoiceParser");
const {
  assertInvoiceStockReferences,
  insertStockImpuestosFromTemplate,
} = require("../utils/invoiceStockMssql");

/** Legacy StockComprobantes string widths — trim to avoid error 8152 (truncation). */
const CPB_MAX = { tipocomprobante: 3, prefijocomprobante: 4, numerocomprobante: 8 };

/** Sequelize SELECT: sometimes `[rows]`, sometimes `[rows, metadata]` — return `rows` only. */
function selectResultRows(result) {
  if (result == null) return [];
  if (!Array.isArray(result)) return [];
  if (result.length >= 1 && Array.isArray(result[0])) {
    return result[0];
  }
  return result;
}

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
    const { comprobante, idproveedor = 0, idlocal = 1, iddeposito = 1, items, totales } = req.body;

    if (!comprobante || !Array.isArray(items) || items.length === 0) {
      await t.rollback();
      return res.status(400).json({ mensaje: "Se requiere comprobante e items" });
    }

    await assertInvoiceStockReferences(sql, t, {
      idlocal,
      iddeposito,
      idproveedor,
      articuloCodigos: items.map((it) => it.articuloCodigo),
    });

    const tipoMap = { A: "FCA", B: "FCB", C: "FCC" };
    const tipoComprobante = tipoMap[comprobante.tipo] || comprobante.tipo || "FCA";
    const tipoSql = String(tipoComprobante).trim().slice(0, CPB_MAX.tipocomprobante);
    const prefijoSql = String(comprobante.prefijo ?? "")
      .trim()
      .slice(0, CPB_MAX.prefijocomprobante);
    const numeroSql = String(comprobante.numero ?? "")
      .trim()
      .slice(0, CPB_MAX.numerocomprobante);

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

    // idk is IDENTITY. OUTPUT without INTO is invalid when the table has triggers;
    // use OUTPUT ... INTO @table to capture the new row id safely.
    // String widths from MRCCENTRAL: tipocomprobante char(3), prefijocomprobante char(4), numerocomprobante char(8);
    // fechacomprobante is datetime — bind as date, not varchar.
    const insertedCpb = selectResultRows(
      await sql.query(
        `DECLARE @newId TABLE (idk DECIMAL(18, 0));
      INSERT INTO MRCCENTRAL.DBO.StockComprobantes (
        idcomprobante, tipocomprobante, prefijocomprobante, numerocomprobante,
        fechacomprobante, totalcomprobante, bonificacioncomprobante,
        idproveedor, tipomovimiento, idcausamovimiento, anulado,
        idlocal, iddeposito, fechamovimiento, horamovimiento
      )
      OUTPUT INSERTED.idk INTO @newId
      VALUES (
        :nextIdComprobante, :tipo, :prefijo, :numero,
        TRY_CONVERT(DATE, :fecha, 23), :total, :bonificacion,
        :idproveedor, 'IN', 1, 0,
        :idlocal, :iddeposito, GETDATE(), CONVERT(char(8), GETDATE(), 108)
      );
      SELECT idk FROM @newId;`,
        {
          type: sql.QueryTypes.SELECT,
          replacements: {
            nextIdComprobante,
            tipo: tipoSql,
            prefijo: prefijoSql,
            numero: numeroSql,
            fecha: comprobante.fecha,
            total: comprobante.total,
            bonificacion: comprobante.bonificacion,
            idproveedor,
            idlocal,
            iddeposito,
          },
          transaction: t,
        }
      )
    );
    const idkRow = insertedCpb[0];
    const nextComprobanteIdk = idkRow?.idk ?? idkRow?.IDK;
    if (nextComprobanteIdk == null) {
      throw new Error("No se pudo leer idk del comprobante insertado");
    }

    for (const item of items) {
      await sql.query(
        `INSERT INTO MRCCENTRAL.DBO.StockMovimientos (
          idcomprobante, idproducto, cantidad, precio
        ) VALUES (
          :idcomprobante, :idproducto, :cantidad, :precio
        )`,
        {
          replacements: {
            idcomprobante: nextComprobanteIdk,
            idproducto: item.articuloCodigo,
            cantidad: item.cantidad,
            precio: item.precio,
          },
          transaction: t,
        }
      );
    }

    await insertStockImpuestosFromTemplate(sql, t, nextComprobanteIdk, totales);

    await t.commit();
    res.status(201).json({
      mensaje: "Stock registrado correctamente",
      comprobanteIdk: nextComprobanteIdk,
      movimientos: items.length,
    });
  } catch (error) {
    await t.rollback();
    console.error("Error guardando stock:", error);
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
  parseInvoicePdf,
  matchInvoiceItems,
  saveInvoiceStock,
};
