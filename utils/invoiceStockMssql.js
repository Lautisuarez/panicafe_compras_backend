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
};
