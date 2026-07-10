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
 * Open balance for stock IN: same idlocal as num_local in locales / request body.
 * @returns {Promise<number>}
 */
async function fetchOpenBalanceIdForLocal(sql, t, idlocal) {
  const rows = unwrapSelect(
    await sql.query(
      `SELECT TOP 1 idbalance
       FROM MRCCENTRAL.dbo.balance
       WHERE idlocal = :idlocal AND cerrado = 0
       ORDER BY idbalance DESC`,
      {
        type: sql.QueryTypes.SELECT,
        transaction: t,
        replacements: { idlocal },
      }
    )
  );
  if (!rows.length) {
    const e = new Error(
      `No hay balance abierto (cerrado = 0) para el local ${idlocal}.`
    );
    e.statusCode = 400;
    throw e;
  }
  const raw = rows[0];
  const idb = raw.idbalance ?? raw.IDBALANCE;
  if (idb == null) {
    const e = new Error("La consulta de balance no devolvió idbalance.");
    e.statusCode = 500;
    throw e;
  }
  return Number(idb);
}

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
    // StockComprobantes.idproveedor references proveed.pr_codigo (not id / idk).
    const pr = await sql.query(
      `SELECT 1 AS ok FROM MRCCENTRAL.dbo.proveed
       WHERE pr_codigo = :p AND ISNULL(inhabilitado, 0) = 0 AND ISNULL(anulado, 0) = 0`,
      { type: sql.QueryTypes.SELECT, transaction: t, replacements: { p: idproveedor } }
    );
    if (pr.length === 0) {
      throw err(
        `idproveedor ${idproveedor} does not exist or is disabled in MRCCENTRAL.dbo.proveed (pr_codigo).`
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

/**
 * Resolve `idproveedor` (= proveed.pr_codigo) from emisor CUIT (11 digits).
 * Returns 0 when the CUIT is invalid or not found.
 */
async function findIdProveedorByCuit(sql, t, cuit) {
  const c = String(cuit ?? "").replace(/\D/g, "");
  if (c.length !== 11) return 0;
  const rows = unwrapSelect(
    await sql.query(
      `SELECT TOP 1 pr_codigo
         FROM MRCCENTRAL.dbo.proveed
        WHERE REPLACE(REPLACE(RTRIM(LTRIM(pr_docu)), '-', ''), ' ', '') = :c
          AND ISNULL(inhabilitado, 0) = 0
          AND ISNULL(anulado, 0) = 0
        ORDER BY pr_codigo`,
      { type: sql.QueryTypes.SELECT, transaction: t, replacements: { c } }
    )
  );
  if (!rows.length) return 0;
  const v = Number(rows[0].pr_codigo ?? rows[0].PR_CODIGO ?? 0);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Block re-saving the same invoice (tipo + prefijo + numero, optionally same proveedor)
 * already present as IN, non-anulado, in StockComprobantes.
 *
 * Compares prefijo / numero by integer value to be robust to leading-zero formatting.
 *
 * @throws Error with statusCode 409 when a duplicate exists.
 */
async function assertNoDuplicateInvoice(
  sql,
  t,
  { tipoSql, prefijoSql, numeroSql, idproveedor }
) {
  const prefInt = parseInt(String(prefijoSql).replace(/\D/g, ""), 10);
  const numInt = parseInt(String(numeroSql).replace(/\D/g, ""), 10);
  if (!Number.isFinite(prefInt) || !Number.isFinite(numInt)) return;

  const params = {
    tipo: tipoSql,
    prefInt,
    numInt,
    prov: Number(idproveedor) || 0,
  };

  // Same supplier (when known) OR fallback: same tipo+prefijo+numero with no supplier.
  const dupes = unwrapSelect(
    await sql.query(
      `SELECT TOP 5 idk, idproveedor, totalcomprobante, fechamovimiento
         FROM MRCCENTRAL.dbo.StockComprobantes
        WHERE tipomovimiento = 'IN'
          AND ISNULL(anulado, 0) = 0
          AND RTRIM(tipocomprobante) = :tipo
          AND TRY_CAST(prefijocomprobante AS INT) = :prefInt
          AND TRY_CAST(numerocomprobante AS INT) = :numInt
          AND (:prov = 0 OR idproveedor = :prov OR idproveedor = 0)
        ORDER BY idk DESC`,
      { type: sql.QueryTypes.SELECT, transaction: t, replacements: params }
    )
  );

  if (dupes.length > 0) {
    const ref = dupes[0];
    const idkRef = ref.idk ?? ref.IDK;
    const e = new Error(
      `Esta factura ya esta registrada (idk ${idkRef}, ${tipoSql} ${String(
        prefijoSql
      ).padStart(4, "0")}-${String(numeroSql).padStart(8, "0")}).`
    );
    e.statusCode = 409;
    throw e;
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
    idbalance,
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
  if (idbalance != null && Number.isFinite(Number(idbalance))) {
    const bal = Number(idbalance);
    const balKey = Object.keys(row).find((k) => k.toLowerCase() === "idbalance");
    if (balKey) {
      row[balKey] = bal;
    } else {
      row.idbalance = bal;
    }
  }
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
 * @param {{ comprobanteIdk: number, item: { articuloCodigo: unknown, cantidad: unknown, precio: unknown, iva?: unknown } }} params
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
  setRowColCaseInsensitive(row, "observaciones", "");
  if (item.iva != null) {
    setRowColCaseInsensitive(row, "iva", toNumOrZero(item.iva));
  }

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

/**
 * Clone STOCKIMPUESTOS from latest IN (FCA/FCB/FCC) row to reuse its column shape,
 * then rebuild the tax detail from `totales`.
 *
 * IMPORTANTE: la plantilla se clona SOLO por su estructura; sus importes son de
 * otra factura. Hay que reescribir todos los subdiarios (incluido el 24 =
 * "TOTAL COMPROBANTE"), si no la nueva factura hereda importes ajenos y el total
 * se recalcula mal al editar en mrcomanda.
 */
async function insertStockImpuestosFromTemplate(sql, t, comprobanteIdk, totales) {
  const tNum = toNum(totales?.total);
  const nNum = toNum(totales?.netoGravado);
  if (tNum == null || tNum <= 0) return;

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

  // Limpiar los 23 subdiarios de detalle heredados de la plantilla (importes de
  // otra factura). El 24 se reescribe aparte con el TOTAL real de esta factura.
  for (let i = 1; i <= 23; i++) {
    setRowColCaseInsensitive(row, `IMPORTESUBDIARIO${i}`, 0);
    setRowColCaseInsensitive(row, `PORCENTAJESUBDIARIO${i}`, 0);
    setRowColCaseInsensitive(row, `DESCRIPCIONSUBDIARIO${i}`, "");
  }

  // Subdiario 1: neto gravado.
  setRowColCaseInsensitive(row, "IMPORTESUBDIARIO1", nNum != null && nNum >= 0 ? nNum : 0);
  setRowColCaseInsensitive(row, "PORCENTAJESUBDIARIO1", 0);
  setRowColCaseInsensitive(row, "DESCRIPCIONSUBDIARIO1", "NETO GRAVADO");

  // Subdiarios 2..N: un renglon "IVA INSCRIPTO" por cada alicuota presente
  // (mismo patron que las cargas manuales de mrcomanda). Antes solo se guardaba
  // el 21%, por lo que las facturas con otras alicuotas quedaban sin IVA.
  const ivaBuckets = [
    [27, toNum(totales?.iva27)],
    [21, toNum(totales?.iva21)],
    [10.5, toNum(totales?.iva105)],
    [5, toNum(totales?.iva5)],
    [2.5, toNum(totales?.iva25)],
  ];
  let slot = 2;
  for (const [pct, imp] of ivaBuckets) {
    if (imp != null && imp > 0 && slot <= 23) {
      setRowColCaseInsensitive(row, `IMPORTESUBDIARIO${slot}`, imp);
      setRowColCaseInsensitive(row, `PORCENTAJESUBDIARIO${slot}`, pct);
      setRowColCaseInsensitive(row, `DESCRIPCIONSUBDIARIO${slot}`, "IVA INSCRIPTO");
      slot++;
    }
  }

  // Subdiario 24: TOTAL COMPROBANTE con el importe real de esta factura.
  setRowColCaseInsensitive(row, "IMPORTESUBDIARIO24", tNum);
  setRowColCaseInsensitive(row, "PORCENTAJESUBDIARIO24", 0);
  setRowColCaseInsensitive(row, "DESCRIPCIONSUBDIARIO24", "TOTAL COMPROBANTE");

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
  assertNoDuplicateInvoice,
  fetchOpenBalanceIdForLocal,
  findIdProveedorByCuit,
  insertStockImpuestosFromTemplate,
  insertStockComprobanteWithTemplate,
  insertStockMovimientoWithTemplate,
};
