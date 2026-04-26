const db = require("../db/db");
const { bitToBoolean } = require("./sqlHelpers");

const PEDIDO_ENABLE_COLUMN = "PERMITE_PEDIDO_COMPRAS";

const getProductos = async (req, res) => {
  try {
    const rows = await db.sequelize.query(
      `SELECT a.CODIGO, a.DESCRIP, a.PRECIO, r.r_descrip,
        CAST(a.${PEDIDO_ENABLE_COLUMN} AS INT) AS permitePedidoCompras
      FROM MRCCENTRAL.DBO.ARTICULO a
      JOIN MRCCENTRAL.DBO.RUBRO r ON a.rubro = r.r_codigo
      WHERE a.SEVENDE=1 AND a.INVISIBL=0 AND a.WEB=1
      ORDER BY a.DESCRIP`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    const resultToSend = rows.map((item) => {
      const rawFlag =
        item.permitePedidoCompras ??
        item.PERMITE_PEDIDO_COMPRAS ??
        item.PERMITEPEDIDOCOMPRAS;
      return {
        id: parseInt(item.CODIGO, 10),
        descripcion: (item.DESCRIP || "").toString().trim(),
        precio: item.PRECIO,
        rubro: (item.r_descrip || "").toString().trim(),
        permitePedidoCompras: bitToBoolean(rawFlag),
      };
    });

    res.json(resultToSend);
  } catch (e) {
    res.status(500).json("Error al obtener los productos. Detalle: " + e);
  }
};

const getRubros = async (req, res) => {
  try {
    await db.sequelize
      .query(
        `SELECT r_descrip
            FROM MRCCENTRAL.DBO.RUBRO
            WHERE web=1`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )
      .then((rows) => {
        const resultToSend = rows.map((item) => {
          return { rubro: item.r_descrip.trim() };
        });
        res.json(resultToSend);
      });
  } catch (e) {
    res.status(500).json("Error al obtener los rubros. Detalle: " + e);
  }
};

const patchArticuloPedidoHabilitado = async (req, res) => {
  try {
    const { codigo, habilitado } = req.body;
    const parsedCodigo = parseInt(codigo, 10);

    if (Number.isNaN(parsedCodigo) || typeof habilitado !== "boolean") {
      return res
        .status(400)
        .json("codigo debe ser numérico y habilitado debe ser boolean");
    }

    const articulo = await db.sequelize.query(
      `SELECT CODIGO FROM MRCCENTRAL.DBO.ARTICULO WHERE CODIGO = :codigo`,
      {
        replacements: { codigo: parsedCodigo },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    if (articulo.length === 0) {
      return res.status(404).json("Artículo no encontrado");
    }

    await db.sequelize.query(
      `UPDATE MRCCENTRAL.DBO.ARTICULO
      SET ${PEDIDO_ENABLE_COLUMN} = :habilitado
      WHERE CODIGO = :codigo`,
      {
        replacements: { codigo: parsedCodigo, habilitado: habilitado ? 1 : 0 },
        type: db.sequelize.QueryTypes.UPDATE,
      }
    );

    res.status(200).json({
      codigo: parsedCodigo,
      habilitado,
      mensaje: "Estado de pedido actualizado correctamente",
    });
  } catch (error) {
    res
      .status(500)
      .json("Error al actualizar habilitación de pedido. Detalle: " + error);
  }
};

const searchProductos = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ mensaje: "El parámetro 'q' debe tener al menos 2 caracteres" });
    }

    const palabras = q.trim().split(/\s+/).filter((w) => w.length >= 2);
    if (palabras.length === 0) {
      return res.json([]);
    }

    const whereClauses = palabras.map((_, idx) => `a.DESCRIP LIKE :word${idx}`);
    const replacements = {};
    palabras.forEach((w, idx) => { replacements[`word${idx}`] = `%${w}%`; });

    const rows = await db.sequelizeInvoiceCatalog.query(
      `SELECT TOP 20 a.CODIGO, a.DESCRIP, a.PRECIO, r.r_descrip
       FROM MRCCENTRAL.DBO.ARTICULO a
       JOIN MRCCENTRAL.DBO.RUBRO r ON a.rubro = r.r_codigo
       WHERE a.INVISIBL = 0
         AND (${whereClauses.join(" AND ")})
       ORDER BY a.DESCRIP`,
      { replacements, type: db.sequelizeInvoiceCatalog.QueryTypes.SELECT }
    );

    const resultToSend = rows.map((item) => ({
      codigo: parseInt(item.CODIGO, 10),
      descripcion: (item.DESCRIP || "").toString().trim(),
      precio: item.PRECIO,
      rubro: (item.r_descrip || "").toString().trim(),
    }));

    res.json(resultToSend);
  } catch (error) {
    console.error("Error buscando productos:", error);
    if (error.code === "SQL_DISABLED") {
      return res.status(503).json({ mensaje: "SQL Server no configurado." });
    }
    res.status(500).json({ mensaje: "Error al buscar productos" });
  }
};

module.exports = {
  getProductos,
  getRubros,
  patchArticuloPedidoHabilitado,
  searchProductos,
};
