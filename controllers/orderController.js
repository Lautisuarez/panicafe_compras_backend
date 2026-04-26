const db = require("../db/db");
const mongo = require("../db/mongo");

// Validates the request body before opening a DB transaction.
function parseCreatePedidoBody(body) {
  const productos = body?.productos;
  if (!Array.isArray(productos) || productos.length === 0) {
    return { error: "Pedido vacío" };
  }

  const productIds = [
    ...new Set(
      productos
        .map((p) => parseInt(p.id, 10))
        .filter((id) => !Number.isNaN(id))
    ),
  ];
  if (productIds.length === 0) {
    return { error: "No se encontraron productos válidos" };
  }

  const idCliente = parseInt(body.idCliente, 10);
  const precioTotal = Number(body.precioTotal);
  if (Number.isNaN(idCliente) || !Number.isFinite(precioTotal)) {
    return { error: "idCliente o precioTotal inválidos" };
  }

  const lineItems = [];
  for (const p of productos) {
    const idProducto = parseInt(p.id, 10);
    const preciounit = Number(p.precio);
    const cantidad = Number(p.cantidad);
    if (
      Number.isNaN(idProducto) ||
      !Number.isFinite(preciounit) ||
      !Number.isFinite(cantidad)
    ) {
      return { error: "Datos de producto en el pedido inválidos" };
    }
    lineItems.push({
      idProducto,
      preciounit,
      cantidad,
      descripcion: (p.descripcion ?? "").toString(),
    });
  }

  return {
    data: {
      idCliente,
      precioTotal,
      fecha: body.fecha,
      productIds,
      lineItems,
    },
  };
}

const postPedido = async (req, res) => {
  const parsed = parseCreatePedidoBody(req.body);
  if (parsed.error) {
    return res.status(400).json(parsed.error);
  }
  const { idCliente, precioTotal, fecha, productIds, lineItems } = parsed.data;

  const t = await db.sequelize.transaction();
  try {
    const enabledProducts = await db.sequelize.query(
      `SELECT CODIGO
      FROM MRCCENTRAL.DBO.ARTICULO
      WHERE CODIGO IN (:productIds)
      AND SEVENDE=1
      AND INVISIBL=0
      AND WEB=1
      AND PERMITE_PEDIDO_COMPRAS=1`,
      {
        replacements: { productIds },
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    if (enabledProducts.length !== productIds.length) {
      await t.rollback();
      return res
        .status(400)
        .json("Hay productos no habilitados para agregar al pedido");
    }

    const idPedidoFromSQL = await db.sequelize.query(
      `SELECT top 1 idPedido FROM MRCCENTRAL.DBO.car_pedidos order by idPedido DESC ;`,
      {
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    const nextIdPedido = idPedidoFromSQL[0].idPedido + 1;

    await db.sequelize.query(
      `INSERT INTO MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal) 
      VALUES (:idCliente, :fecha, :precioTotal);`,
      {
        replacements: { idCliente, fecha, precioTotal },
        transaction: t,
      }
    );

    for (const line of lineItems) {
      const { idProducto, preciounit, cantidad, descripcion } = line;
      await db.sequelize.query(
        `INSERT INTO MRCCENTRAL.DBO.car_productos (idPedido, idProducto, descripcion, preciounit, cantidad)
        VALUES (:idPedido, :idProducto, :descripcion, :preciounit, :cantidad)`,
        {
          replacements: {
            idPedido: nextIdPedido,
            idProducto,
            descripcion,
            preciounit,
            cantidad,
          },
          transaction: t,
        }
      );
    }

    await t.commit();
    res.status(201).json("Pedido creado");
  } catch (e) {
    await t.rollback();
    if (e.code === "SQL_DISABLED") {
      return res.status(503).json({
        error: "SQL Server no configurado en este entorno.",
      });
    }
    res.status(500).json(`Error al ingresar el pedido: ${e}`);
  }
};

const localeOptions = {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

function formatPedidoFecha(fecha) {
  return new Date(fecha).toLocaleString("es-ES", localeOptions);
}

const misPedidos = async (req, res) => {
  const idCliente = Number(req.decoded?.id);
  if (!Number.isFinite(idCliente)) {
    return res.status(400).json({ error: "Cliente inválido" });
  }

  try {
    let listaDePedidos = await db.sequelize.query(
      `SELECT TOP 10 idPedido, fecha, precioTotal 
        FROM MRCCENTRAL.DBO.car_pedidos 
        WHERE idCliente = :idCliente 
        ORDER BY idPedido DESC;`,
      {
        replacements: { idCliente },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    listaDePedidos = listaDePedidos.map((pedido) => {
      pedido.fecha = formatPedidoFecha(pedido.fecha);
      return pedido;
    });

    res.json(listaDePedidos);
  } catch (err) {
    console.error(err);
    if (err.code === "SQL_DISABLED") {
      return res.status(503).json({
        error:
          "SQL Server no configurado en este entorno.",
      });
    }
    res.status(500).json({ error: "Error al obtener los pedidos" });
  }
};

const pedidoPorUsuario = async (req, res) => {
  const { usuario, desde, hasta } = req.query;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!usuario || !desde || !hasta || !dateRe.test(String(desde)) || !dateRe.test(String(hasta))) {
    return res.status(400).json({
      error: "Se requieren usuario, desde y hasta (fechas en formato YYYY-MM-DD)",
    });
  }
  try {
    const usuarioFounded = await mongo.usuarios.find({ usuario: usuario.toLowerCase() });
    if (!usuarioFounded[0]) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const idCliente = usuarioFounded[0].id;

    let listaDePedidos = await db.sequelize.query(
      `SELECT idPedido, fecha, precioTotal
            FROM MRCCENTRAL.DBO.car_pedidos
            WHERE idCliente = :idCliente
            AND fecha BETWEEN :desdeInicio AND :hastaFin
            ORDER BY idPedido DESC;`,
      {
        replacements: {
          idCliente,
          desdeInicio: `${desde} 00:00:00`,
          hastaFin: `${hasta} 23:59:59`,
        },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    listaDePedidos = listaDePedidos.map((pedido) => {
      pedido.fecha = formatPedidoFecha(pedido.fecha);
      return pedido;
    });

    res.json(listaDePedidos);
  } catch (err) {
    console.error(err);
    if (err.code === "SQL_DISABLED") {
      return res.status(503).json({
        error:
          "SQL Server no configurado en este entorno.",
      });
    }
    res.status(500).json({ error: "Error al obtener los pedidos" });
  }
};

const pedidosDetalle = async (req, res) => {
  const { idPedidos } = req.body;

  if (!Array.isArray(idPedidos) || idPedidos.length === 0) {
    return res.status(400).json({ error: "Se requiere un array de ids" });
  }

  const idsNumericos = idPedidos.map((x) => parseInt(x, 10));
  if (idsNumericos.some((n) => Number.isNaN(n) || n < 1)) {
    return res.status(400).json({ error: "Cada id de pedido debe ser un entero positivo" });
  }

  try {
    const productos = await db.sequelize.query(
      `SELECT prod.cantidad, prod.descripcion, prod.preciounit, rub.r_descrip
         FROM MRCCENTRAL.DBO.car_productos prod
         JOIN MRCCENTRAL.DBO.ARTICULO art ON art.codigo=prod.idProducto
         JOIN MRCCENTRAL.DBO.RUBRO rub ON art.rubro=rub.r_codigo
         WHERE idPedido IN (:idPedidos) AND art.SEVENDE=1 AND art.INVISIBL=0 AND art.WEB=1
         ORDER BY rub.r_descrip ASC `,
      {
        replacements: { idPedidos: idsNumericos },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    res.json(productos);
  } catch (error) {
    console.error("Error al obtener productos:", error);
    if (error.code === "SQL_DISABLED") {
      return res.status(503).json({
        error:
          "SQL Server no configurado en este entorno.",
      });
    }
    res.status(500).json({ error: "Error al obtener productos" });
  }
};

const misPedidosDetalle = async (req, res) => {
  const idPedido = parseInt(req.body.idPedido, 10);
  if (Number.isNaN(idPedido) || idPedido < 1) {
    return res.status(400).json({ error: "idPedido inválido" });
  }

  try {
    const productos = await db.sequelize.query(
      `SELECT cantidad, descripcion, preciounit FROM MRCCENTRAL.DBO.car_productos WHERE idPedido = :idPedido;`,
      {
        replacements: { idPedido },
        type: db.sequelize.QueryTypes.SELECT,
      }
    );
    res.json(productos);
  } catch (err) {
    console.error(err);
    if (err.code === "SQL_DISABLED") {
      return res.status(503).json({
        error:
          "SQL Server no configurado en este entorno.",
      });
    }
    res.status(500).json({ error: "Error al obtener el detalle del pedido" });
  }
};

module.exports = {
  postPedido,
  misPedidos,
  pedidoPorUsuario,
  pedidosDetalle,
  misPedidosDetalle,
};
