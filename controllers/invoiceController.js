const db = require("../db/db");
const pdfParse = require("pdf-parse");
const parseInvoiceText = require("../utils/invoiceParser");
const {
  assertInvoiceStockReferences,
  insertStockImpuestosFromTemplate,
} = require("../utils/invoiceStockMssql");

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

    const lastIdkResult = await sql.query(
      `SELECT TOP 1 idk FROM MRCCENTRAL.DBO.StockComprobantes ORDER BY idk DESC`,
      { type: sql.QueryTypes.SELECT, transaction: t }
    );
    const nextComprobanteIdk = (lastIdkResult.length > 0 ? lastIdkResult[0].idk : 0) + 1;

    await sql.query(
      `INSERT INTO MRCCENTRAL.DBO.StockComprobantes (
        idk, tipocomprobante, prefijocomprobante, numerocomprobante,
        fechacomprobante, totalcomprobante, bonificacioncomprobante,
        idproveedor, tipomovimiento, anulado,
        idlocal, iddeposito, fechamovimiento, horamovimiento
      ) VALUES (
        :idk, :tipo, :prefijo, :numero,
        :fecha, :total, :bonificacion,
        :idproveedor, 'IN', 0,
        :idlocal, :iddeposito, GETDATE(), CONVERT(char(8), GETDATE(), 108)
      )`,
      {
        replacements: {
          idk: nextComprobanteIdk,
          tipo: tipoComprobante,
          prefijo: comprobante.prefijo,
          numero: comprobante.numero,
          fecha: comprobante.fecha,
          total: comprobante.total,
          bonificacion: comprobante.bonificacion,
          idproveedor,
          idlocal,
          iddeposito,
        },
        transaction: t,
      }
    );

    const lastMovIdkResult = await sql.query(
      `SELECT TOP 1 idk FROM MRCCENTRAL.DBO.StockMovimientos ORDER BY idk DESC`,
      { type: sql.QueryTypes.SELECT, transaction: t }
    );
    let nextMovIdk = (lastMovIdkResult.length > 0 ? lastMovIdkResult[0].idk : 0) + 1;

    for (const item of items) {
      await sql.query(
        `INSERT INTO MRCCENTRAL.DBO.StockMovimientos (
          idk, idcomprobante, idproducto, cantidad, precio
        ) VALUES (
          :idk, :idcomprobante, :idproducto, :cantidad, :precio
        )`,
        {
          replacements: {
            idk: nextMovIdk,
            idcomprobante: nextComprobanteIdk,
            idproducto: item.articuloCodigo,
            cantidad: item.cantidad,
            precio: item.precio,
          },
          transaction: t,
        }
      );
      nextMovIdk++;
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
