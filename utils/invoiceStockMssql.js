const crypto = require("crypto");

const toNum = (v) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const padCodeVariants = (articuloCodigo) => {
  const n = Number(articuloCodigo);
  if (!Number.isFinite(n)) return [];
  const s = String(articuloCodigo).trim();
  return [...new Set([s, String(n), n.toString().padStart(4, "0")])];
};

/**
 * @param {import('sequelize').Sequelize} sql sequelizeInvoiceCatalog
 * @param {import('sequelize').Transaction} t
 * @param {number} idlocal
 * @param {number} iddeposito
 * @param {number} idproveedor
 * @param {number[]} articuloCodigos
 * @returns {Promise<void>}
 * @throws {Error} with statusCode 400
 */
async function assertInvoiceStockReferences(
  sql,
  t,
  { idlocal, iddeposito, idproveedor, articuloCodigos }
) {
  const err = (msg) => {
    const e = new Error(msg);
    e.statusCode = 400;
    return e;
  };

  const loc = await sql.query(
    `SELECT 1 AS ok FROM MRCCENTRAL.dbo.locales WHERE num_local = :idlocal`,
    { type: sql.QueryTypes.SELECT, transaction: t, replacements: { idlocal } }
  );
  if (loc.length === 0) {
    throw err(`idlocal ${idlocal} does not exist in MRCCENTRAL.dbo.locales.`);
  }

  const dep = await sql.query(
    `SELECT 1 AS ok FROM MRCCENTRAL.dbo.deposito WHERE num_depo = :iddep`,
    { type: sql.QueryTypes.SELECT, transaction: t, replacements: { iddep: iddeposito } }
  );
  if (dep.length === 0) {
    throw err(`iddeposito ${iddeposito} is missing in MRCCENTRAL.dbo.deposito.`);
  }

  if (idproveedor > 0) {
    const pr = await sql.query(
      `SELECT 1 AS ok FROM MRCCENTRAL.dbo.proveed WHERE id = :p OR idk = :p`,
      { type: sql.QueryTypes.SELECT, transaction: t, replacements: { p: idproveedor } }
    );
    if (pr.length === 0) {
      throw err(
        `idproveedor ${idproveedor} does not exist in MRCCENTRAL.dbo.proveed (id / idk).`
      );
    }
  }

  for (const cod of articuloCodigos) {
    const vars = padCodeVariants(cod);
    if (vars.length === 0) {
      throw err(`Invalid article code: ${cod}`);
    }
    const replacements = {};
    const ors = vars.map((v, i) => {
      const k = `ac_${String(cod).replace(/\W/g, "_")}_${i}`;
      replacements[k] = v;
      return `RTRIM(a.CODIGO) = :${k}`;
    });
    const art = await sql.query(
      `SELECT TOP 1 1 AS ok FROM MRCCENTRAL.dbo.ARTICULO a
       WHERE a.INVISIBL = 0 AND (${ors.join(" OR ")})`,
      { type: sql.QueryTypes.SELECT, transaction: t, replacements }
    );
    if (art.length === 0) {
      throw err(
        `ARTICULO not found (visible) for codigo like "${cod}" in this database.`
      );
    }
  }
}

function setRowColCaseInsensitive(row, colName, value) {
  const k = Object.keys(row).find((x) => x.toLowerCase() === colName.toLowerCase());
  if (k) {
    row[k] = value;
  }
}

function deleteColCI(row, colName) {
  const k = Object.keys(row).find((x) => x.toLowerCase() === colName.toLowerCase());
  if (k) {
    delete row[k];
  }
}

/** Same shape as in invoiceController: Sequelize can return [rows] or [rows, meta]. */
function unwrapSelect(result) {
  if (result == null) return [];
  if (Array.isArray(result) && result.length >= 1 && Array.isArray(result[0])) {
    return result[0];
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

function horaMovimientoNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function toNumOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * SQL Server `datetime` (not `datetimeoffset`) often fails on literals with a timezone (e.g. from Tedious/Date binding).
 * Send plain "yyyy-MM-dd HH:mm:ss.mmm" without offset.
 */
function dateToMssqlDateTimeString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    return d;
  }
  const p = (n) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes()) +
    ":" +
    p(d.getSeconds()) +
    "." +
    ms
  );
}

/** Row may contain `Date` from the driver on template; convert all datetimes, keep horamovimiento as char(8) time. */
function normalizeMssqlComprobanteRowDates(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    const kl = k.toLowerCase();
    if (kl === "horamovimiento") {
      if (v instanceof Date) {
        const p = (n) => String(n).padStart(2, "0");
        row[k] = `${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
      }
      continue;
    }
    if (v instanceof Date) {
      row[k] = dateToMssqlDateTimeString(v);
    }
  }
}

/**
 * INSERT full row: copy last IN+tipo row, then override business fields. Avoids NULL on NOT NULL columns.
 * @param {import('sequelize').Sequelize} sql
 * @param {import('sequelize').Transaction} t
 * @returns {Promise<number>} new idk
 */
async function insertStockComprobanteWithTemplate(
  sql,
  t,
  {
    nextIdComprobante,
    comprobante,
    idproveedor,
    idlocal,
    iddeposito,
    tipoSql,
    prefijoSql,
    numeroSql,
    observacionesSql,
  }
) {
  const q1 = `SELECT TOP 1 * FROM MRCCENTRAL.dbo.StockComprobantes
     WHERE tipomovimiento = 'IN' AND tipocomprobante = :tipo
     ORDER BY idk DESC`;
  let rows = unwrapSelect(
    await sql.query(q1, {
      type: sql.QueryTypes.SELECT,
      transaction: t,
      replacements: { tipo: tipoSql },
    })
  );
  if (rows.length === 0) {
    const q2 = `SELECT TOP 1 * FROM MRCCENTRAL.dbo.StockComprobantes
       WHERE tipomovimiento = 'IN' ORDER BY idk DESC`;
    rows = unwrapSelect(
      await sql.query(q2, { type: sql.QueryTypes.SELECT, transaction: t })
    );
  }
  if (rows.length === 0) {
    const e = new Error(
      "No hay fila de referencia IN en StockComprobantes para armar el alta (plantilla vacía)"
    );
    e.statusCode = 400;
    throw e;
  }

  const row = { ...rows[0] };
  deleteColCI(row, "idk");
  deleteColCI(row, "ts");

  setRowColCaseInsensitive(row, "idcomprobante", nextIdComprobante);
  setRowColCaseInsensitive(row, "tipocomprobante", tipoSql);
  setRowColCaseInsensitive(row, "prefijocomprobante", prefijoSql);
  setRowColCaseInsensitive(row, "numerocomprobante", numeroSql);
  const fd = comprobante.fecha
    ? new Date(String(comprobante.fecha).slice(0, 10))
    : new Date();
  setRowColCaseInsensitive(
    row,
    "fechacomprobante",
    Number.isNaN(fd.getTime()) ? new Date() : fd
  );
  setRowColCaseInsensitive(row, "totalcomprobante", toNumOrZero(comprobante.total));
  setRowColCaseInsensitive(
    row,
    "bonificacioncomprobante",
    toNumOrZero(comprobante.bonificacion)
  );
  setRowColCaseInsensitive(row, "idproveedor", idproveedor);
  setRowColCaseInsensitive(row, "tipomovimiento", "IN");
  setRowColCaseInsensitive(row, "idcausamovimiento", 1);
  setRowColCaseInsensitive(row, "anulado", 0);
  setRowColCaseInsensitive(row, "idlocal", idlocal);
  setRowColCaseInsensitive(row, "iddeposito", iddeposito);
  setRowColCaseInsensitive(row, "fechamovimiento", new Date());
  setRowColCaseInsensitive(row, "horamovimiento", horaMovimientoNow());
  setRowColCaseInsensitive(row, "observaciones", observacionesSql);

  const uiKey = Object.keys(row).find((k) => k.toLowerCase() === "ui");
  if (uiKey) {
    try {
      row[uiKey] = crypto.randomUUID();
    } catch {
      row[uiKey] = "00000000-0000-0000-0000-000000000000";
    }
  }

  for (const k of Object.keys(row)) {
    if (row[k] === undefined) {
      delete row[k];
    }
  }

  normalizeMssqlComprobanteRowDates(row);

  const cols = Object.keys(row);
  if (cols.length === 0) {
    throw new Error("insertStockComprobanteWithTemplate: no columns to insert");
  }
  const colSql = cols.map((c) => `[${c.replace(/]/g, "]]")}]`).join(", ");
  const ph = cols.map((c) => `:${c}`).join(", ");

  const outRaw = await sql.query(
    `DECLARE @newId TABLE (idk DECIMAL(18, 0));
     INSERT INTO MRCCENTRAL.dbo.StockComprobantes (${colSql})
     OUTPUT INSERTED.idk INTO @newId
     VALUES (${ph});
     SELECT idk FROM @newId;`,
    { type: sql.QueryTypes.SELECT, transaction: t, replacements: row }
  );
  const idkRows = unwrapSelect(outRaw);
  const idk = idkRows[0]?.idk ?? idkRows[0]?.IDK;
  if (idk == null) {
    throw new Error("No se pudo leer idk del comprobante insertado");
  }
  return idk;
}

/**
 * @param {import('sequelize').Sequelize} sql
 * @param {import('sequelize').Transaction} t
 * @param {{ comprobanteIdk: number, item: { articuloCodigo: unknown, cantidad: unknown, precio: unknown } }} params
 */
function normalizeMssqlMovimientoRowDates(row) {
  for (const k of Object.keys(row)) {
    if (row[k] instanceof Date) {
      row[k] = dateToMssqlDateTimeString(row[k]);
    }
  }
}

async function insertStockMovimientoWithTemplate(sql, t, { comprobanteIdk, item }) {
  const q1 = `SELECT TOP 1 m.*
     FROM MRCCENTRAL.dbo.StockMovimientos m
     INNER JOIN MRCCENTRAL.dbo.StockComprobantes c ON m.idcomprobante = c.idk
     WHERE c.tipomovimiento = 'IN' AND c.tipocomprobante IN ('FCA', 'FCB', 'FCC')
     ORDER BY m.idk DESC`;
  let rows = unwrapSelect(
    await sql.query(q1, { type: sql.QueryTypes.SELECT, transaction: t })
  );
  if (rows.length === 0) {
    const q2 = `SELECT TOP 1 * FROM MRCCENTRAL.dbo.StockMovimientos ORDER BY idk DESC`;
    rows = unwrapSelect(
      await sql.query(q2, { type: sql.QueryTypes.SELECT, transaction: t })
    );
  }
  if (rows.length === 0) {
    const e = new Error(
      "No hay fila de referencia en StockMovimientos para el alta (plantilla vacía)"
    );
    e.statusCode = 400;
    throw e;
  }

  const row = { ...rows[0] };
  deleteColCI(row, "idk");
  deleteColCI(row, "ts");

  setRowColCaseInsensitive(row, "idcomprobante", comprobanteIdk);
  setRowColCaseInsensitive(row, "idproducto", item.articuloCodigo);
  setRowColCaseInsensitive(row, "cantidad", toNumOrZero(item.cantidad));
  const prec = toNumOrZero(item.precio);
  setRowColCaseInsensitive(row, "precio", prec);
  setRowColCaseInsensitive(row, "precioacuerdo", prec);
  setRowColCaseInsensitive(row, "bonificacion", 0);

  const uiKey = Object.keys(row).find((k) => k.toLowerCase() === "ui");
  if (uiKey) {
    try {
      row[uiKey] = crypto.randomUUID();
    } catch {
      row[uiKey] = "00000000-0000-0000-0000-000000000000";
    }
  }
  const idKey = Object.keys(row).find((k) => k.length === 2 && k.toLowerCase() === "id");
  if (idKey) {
    row[idKey] = 0;
  }
  const txKey = Object.keys(row).find((k) => k.toLowerCase() === "tx");
  if (txKey) {
    row[txKey] = false;
  }
  const oxKey = Object.keys(row).find((k) => k.toLowerCase() === "ox");
  if (oxKey) {
    row[oxKey] = 0;
  }

  for (const k of Object.keys(row)) {
    if (row[k] === undefined) {
      delete row[k];
    }
  }
  normalizeMssqlMovimientoRowDates(row);

  const cols = Object.keys(row);
  const colSql = cols.map((c) => `[${c.replace(/]/g, "]]")}]`).join(", ");
  const ph = cols.map((c) => `:${c}`).join(", ");
  await sql.query(
    `INSERT INTO MRCCENTRAL.dbo.StockMovimientos (${colSql}) VALUES (${ph})`,
    { type: sql.QueryTypes.INSERT, transaction: t, replacements: row }
  );
}

/** Clone STOCKIMPUESTOS from latest IN (FCA/FCB/FCC) row; fill net/IVA from `totales`. */
async function insertStockImpuestosFromTemplate(sql, t, comprobanteIdk, totales) {
  const tNum = toNum(totales?.total);
  const nNum = toNum(totales?.netoGravado);
  const iNum = toNum(totales?.iva21);
  if (tNum == null || tNum <= 0) return;
  if (nNum == null && iNum == null) return;

  const [tpl] = await sql.query(
    `SELECT TOP 1 s.*
     FROM MRCCENTRAL.dbo.STOCKIMPUESTOS s
     INNER JOIN MRCCENTRAL.dbo.StockComprobantes c ON s.IDCOMPROBANTE = c.idk
     WHERE c.tipomovimiento = 'IN' AND c.tipocomprobante IN ('FCA', 'FCB', 'FCC')
     ORDER BY c.idk DESC`,
    { type: sql.QueryTypes.SELECT, transaction: t }
  );
  if (!tpl) {
    return;
  }

  const row = { ...tpl };
  const tsKey = Object.keys(row).find((k) => k.toLowerCase() === "ts");
  if (tsKey) {
    delete row[tsKey];
  }
  // idk is IDENTITY: omit from INSERT so SQL Server generates it
  const idkKey = Object.keys(row).find((k) => k.toLowerCase() === "idk");
  if (idkKey) {
    delete row[idkKey];
  }
  setRowColCaseInsensitive(row, "IDCOMPROBANTE", comprobanteIdk);
  const uiKey = Object.keys(row).find((k) => k.toLowerCase() === "ui");
  if (uiKey) {
    try {
      row[uiKey] = crypto.randomUUID();
    } catch {
      row[uiKey] = "00000000-0000-0000-0000-000000000000";
    }
  }

  if (nNum != null && nNum >= 0) {
    setRowColCaseInsensitive(row, "IMPORTESUBDIARIO1", nNum);
    setRowColCaseInsensitive(row, "PORCENTAJESUBDIARIO1", 0);
    setRowColCaseInsensitive(row, "DESCRIPCIONSUBDIARIO1", "NETO GRAVADO");
  }
  if (iNum != null && iNum >= 0) {
    setRowColCaseInsensitive(row, "IMPORTESUBDIARIO2", iNum);
    setRowColCaseInsensitive(row, "PORCENTAJESUBDIARIO2", 21);
    setRowColCaseInsensitive(row, "DESCRIPCIONSUBDIARIO2", "IVA INSCRIPTO");
  }

  const idKey = Object.keys(row).find(
    (k) => k.length === 2 && k.toLowerCase() === "id"
  );
  if (idKey) {
    row[idKey] = 0;
  }
  const txKey = Object.keys(row).find((k) => k.toLowerCase() === "tx");
  if (txKey) {
    row[txKey] = false;
  }
  const oxKey = Object.keys(row).find((k) => k.toLowerCase() === "ox");
  if (oxKey) {
    row[oxKey] = 0;
  }

  const cols = Object.keys(row).filter((k) => k.toLowerCase() !== "ts");
  const colSql = cols.map((c) => `[${c}]`).join(", ");
  const ph = cols.map((c) => `:${c}`).join(", ");

  await sql.query(
    `INSERT INTO MRCCENTRAL.dbo.STOCKIMPUESTOS (${colSql}) VALUES (${ph})`,
    { type: sql.QueryTypes.INSERT, transaction: t, replacements: row }
  );
}

module.exports = {
  toNum,
  assertInvoiceStockReferences,
  insertStockImpuestosFromTemplate,
  insertStockComprobanteWithTemplate,
  insertStockMovimientoWithTemplate,
};
