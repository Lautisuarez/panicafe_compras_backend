const db = require("../db/db");
const controllers = {};
const mongo = require("../db/mongo");
const { privateKey, jwt } = require("../jwt/jwt");
const PEDIDO_ENABLE_COLUMN = "PERMITE_PEDIDO_COMPRAS";

function bitToBoolean(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (Buffer.isBuffer(value)) return value[0] === 1;
  return Boolean(value);
}

controllers.getProductos = async (req, res) => {
  try {
    let resultSelect = await db.sequelize
      .query(
        `SELECT a.CODIGO, a.DESCRIP, a.PRECIO, r.r_descrip
            FROM MRCCENTRAL.DBO.ARTICULO a
            JOIN MRCCENTRAL.DBO.RUBRO r ON a.rubro=r.r_codigo
            WHERE a.SEVENDE=1 AND a.INVISIBL=0 AND a.WEB=1 AND a.${PEDIDO_ENABLE_COLUMN}=1 
            ORDER BY DESCRIP`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )

      .then((resultSelect) => {
        let resultToSend = resultSelect.map((item) => {
          return {
            id: item.CODIGO,
            descripcion: item.DESCRIP,
            precio: item.PRECIO,
            rubro: item.r_descrip,
          };
        });
        for (var n = 0; n < resultToSend.length; n++) {
          resultToSend[n].id = parseInt(resultToSend[n].id);
          resultToSend[n].descripcion = resultToSend[n].descripcion.trim();
        }
        res.json(resultToSend);
      });
  } catch (e) {
    res.status(500).json("Error al obtener los productos. Detalle: " + e);
  }
};

controllers.getProductosAdmin = async (req, res) => {
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
    res
      .status(500)
      .json("Error al obtener los productos (admin). Detalle: " + e);
  }
};

controllers.getRubros = async (req, res) => {
  try {
    let resultSelect = await db.sequelize
      .query(
        `SELECT r_descrip
            FROM MRCCENTRAL.DBO.RUBRO
            WHERE web=1`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )

      .then((resultSelect) => {
        let resultToSend = resultSelect.map((item) => {
          return { rubro: item.r_descrip.trim() };
        });
        res.json(resultToSend);
      });
  } catch (e) {
    res.status(500).json("Error al obtener los rubros. Detalle: " + e);
  }
};

controllers.postPedido = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    let pedido = req.body;

    if (!pedido.productos) {
      await t.rollback();
      return res.status(400).json("Pedido vacío");
    }

    const productIds = [
      ...new Set(
        pedido.productos
          .map((producto) => parseInt(producto.id, 10))
          .filter((productoId) => !Number.isNaN(productoId))
      ),
    ];

    if (productIds.length === 0) {
      await t.rollback();
      return res.status(400).json("No se encontraron productos válidos");
    }

    const enabledProducts = await db.sequelize.query(
      `SELECT CODIGO
      FROM MRCCENTRAL.DBO.ARTICULO
      WHERE CODIGO IN (:productIds)
      AND SEVENDE=1
      AND INVISIBL=0
      AND WEB=1
      AND ${PEDIDO_ENABLE_COLUMN}=1`,
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

    // Obtengo el último idPedido
    const idPedidoFromSQL = await db.sequelize.query(
      `SELECT top 1 idPedido FROM MRCCENTRAL.DBO.car_pedidos order by idPedido DESC ;`,
      {
        type: db.sequelize.QueryTypes.SELECT,
        transaction: t,
      }
    );

    // Cargo la tabla pedidos
    const insertPedido = await db.sequelize.query(
      `INSERT INTO MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal) 
      VALUES (${pedido.idCliente}, '${pedido.fecha}', ${pedido.precioTotal});`,
      { transaction: t }
    );

    // Cargo la tabla productos con los pedidos
    for (let i = 0; i < pedido.productos.length; i++) {
      await db.sequelize.query(
        `INSERT INTO MRCCENTRAL.DBO.car_productos (idPedido, idProducto, descripcion, preciounit, cantidad)
        VALUES (${idPedidoFromSQL[0].idPedido + 1}, ${pedido.productos[i].id}, 
        '${pedido.productos[i].descripcion}', ${pedido.productos[i].precio}, 
        ${pedido.productos[i].cantidad});`,
        { transaction: t }
      );
    }

    await t.commit();
    res.status(201).json("Pedido creado");
  } catch (e) {
    await t.rollback();
    res.status(500).json(`Error al ingresar el pedido: ${e}`);
  }
};

controllers.patchArticuloPedidoHabilitado = async (req, res) => {
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

//Gestion de usuarios

controllers.getInfoAddUser = async (req, res) => {
  try {
    let getInfo = await db.sequelize
      .query(
        `SELECT num_local, nom_local FROM MRCCENTRAL.DBO.locales order by num_local;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )

      .then((resultSelect) => {
        let resultToSend = resultSelect.map((item) => {
          return { id: item.num_local, nombre: item.nom_local.trim() };
        });

        res.json(resultToSend);
      });
  } catch {
    res
      .status(500)
      .json("La base de datos de Mr. Comanda no esta respondiendo .");
  }
};

controllers.addUser = async (req, res) => {
  const { id, isAdmin, usuario, pass, nombre, email } = req.body;

  let createMongoUser = {
    id: id,
    isAdmin: isAdmin,
    usuario: usuario.toLowerCase(),
    pass: pass,
    nombre: nombre,
    email: email,
  };

  const newUser = new mongo.usuarios(createMongoUser);

  newUser.save();
  res.status(201).json(createMongoUser);
};

controllers.login = async (req, res) => {
  const { usuario, pass } = req.body;
  if (!usuario || !pass) {
    return res.status(400).json("El usuario o contraseña son necesarios.");
  }
  let usuarioLowerCase = usuario.toLowerCase();

  if (mongo.usuarios === undefined)
    return res.status(401).json("Datos Incorrectos");
  const query = mongo.usuarios
    .find({ usuario: usuarioLowerCase })
    .then(function (result) {
      console.log(result[0]);
      ab = result[0].usuario;
      ac = result[0].pass;
      ad = result[0].nombre;
      ae = result[0].isAdmin;
      id = result[0].id;
      if (ab === usuarioLowerCase && ac === pass) {
        const payload = {
          isAdmin: ae,
          id,
        };
        const token = jwt.sign(payload, privateKey, {
          expiresIn: 1440, // 24 minutes
        });

        res.json({
          nombre: ad,
          token: token,
        });
      } else {
        res.status(401).json("Datos Incorrectos");
      }
    })
    .catch((err) => {
      return res.status(401).json("Datos Incorrectos");
    });
};
controllers.getUsers = async (req, res) => {
  let query = await mongo.usuarios.find();
  let usersArray = [];
  for (let x = 0; x <= query.length - 1; x++) {
    usersArray.push(query[x].usuario);
  }
  res.status(200).json(usersArray); //happy path
};

controllers.editUser = async (req, res) => {
  try {
    const datos = req.body;
    const usuariotoLower = datos.usuario.toLowerCase();
    const password = datos.pass;
    let checkUser = await mongo.usuarios.findOne({ usuario: usuariotoLower });
    res.status(201).json("Usuario Modificado");
  } catch (e) {
    console.log(e);
    res.status(401).json("error");
  }
};
controllers.deleteUser = async (req, res) => {
  const target = req.body.usuario.toLowerCase();
  console.log(target);
  await mongo.usuarios.deleteOne({ usuario: target }); //sin el await no lo eliminaba
  res.status(200).json("Usuario eliminado");
};

controllers.misPedidos = async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  let listaDePedidos = [];
  let idCliente = jwt.verify(token, privateKey, (err, decoded) => {
    req.decoded = decoded;
    return decoded.id;
  });

  try {
    listaDePedidos = await db.sequelize.query(
      `SELECT TOP 10 idPedido, fecha, precioTotal 
        FROM MRCCENTRAL.DBO.car_pedidos 
        WHERE idCliente = ${idCliente} 
        ORDER BY idPedido DESC;`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    );

    listaDePedidos = listaDePedidos.map((pedido) => {
      let options = {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      };
      pedido.fecha = new Date(pedido.fecha).toLocaleString("es-ES", options);
      return pedido;
    });

    res.json(listaDePedidos);
  } catch (err) {
    console.log("error", err);
    res.status(500).json({ error: "Error al obtener los pedidos" });
  }
};

controllers.pedidoPorUsuario = async (req, res) => {
  let { usuario, desde, hasta } = req.query;
  await mongo.usuarios
    .find({ usuario: usuario.toLowerCase() })
    .then(async (usuarioFounded) => {
      let listaDePedidos = [];

      try {
        listaDePedidos = await db.sequelize.query(
          `SELECT idPedido, fecha, precioTotal
                FROM MRCCENTRAL.DBO.car_pedidos
                WHERE idCliente = ${usuarioFounded[0].id}
                AND fecha BETWEEN '${desde} 00:00:00' AND '${hasta} 23:59:59'
                ORDER BY idPedido DESC;`,
          {
            type: db.sequelize.QueryTypes.SELECT,
          }
        );

        listaDePedidos = listaDePedidos.map((pedido) => {
          let options = {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          };
          pedido.fecha = new Date(pedido.fecha).toLocaleString(
            "es-ES",
            options
          );
          return pedido;
        });

        res.json(listaDePedidos);
      } catch (err) {
        console.log("error", err);
        res.status(500).json({ error: "Error al obtener los pedidos" });
      }
    });
};

controllers.pedidosDetalle = async (req, res) => {
    const { idPedidos } = req.body;
  
    if (!Array.isArray(idPedidos) || idPedidos.length === 0) {
      return res.status(400).json({ error: "Se requiere un array de ids" });
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
          replacements: { idPedidos },
          type: db.sequelize.QueryTypes.SELECT,
        }
      );
      
      res.json(productos);
    } catch (error) {
      console.error("Error al obtener productos:", error);
      res.status(500).json({ error: "Error al obtener productos" });
    }
  };
  

controllers.misPedidosDetalle = async (req, res) => {
  let id = req.body.idPedido;

  let productos = await db.sequelize
    .query(
      `SELECT cantidad, descripcion, preciounit FROM MRCCENTRAL.DBO.car_productos WHERE idPedido = ${id};`,
      {
        type: db.sequelize.QueryTypes.SELECT,
      }
    )
    .then((productos) => {
      res.json(productos);
    });
};

module.exports = controllers;
