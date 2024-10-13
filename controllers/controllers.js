const db = require("../db/db");
const controllers = {};
const mongo = require("../db/mongo");
const { privateKey, jwt } = require("../jwt/jwt");

controllers.getProductos = async (req, res) => {
  try {
    let resultSelect = await db.sequelize
      .query(
        `SELECT a.CODIGO, a.DESCRIP, a.PRECIO, r.r_descrip
            FROM MRCCENTRAL.DBO.ARTICULO a
            JOIN MRCCENTRAL.DBO.RUBRO r ON a.rubro=r.r_codigo
            WHERE a.SEVENDE=1 AND a.INVISIBL=0 AND a.WEB=1 
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
  try {
    let pedido = req.body;
    if (!pedido.productos) {
      res.status(400).json("Pedido vacio");
    }
    //Obtengo en el ultimo IdPedido
    let idPedidoFromSQL = await db.sequelize
      .query(
        `SELECT top 1 idPedido FROM MRCCENTRAL.DBO.car_pedidos order by idPedido DESC ;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )
      //Cargo la tabla pedidos
      .then((idPedidoFromSQL) => {
        let insertPedido = db.sequelize
          .query(
            `insert into MRCCENTRAL.DBO.car_pedidos (idCliente , fecha, PrecioTotal ) values (${pedido.idCliente}, '${pedido.fecha}', ${pedido.precioTotal});`
          )
          // Cargo la tabla productos con los pedidos
          .then((response) => {
            pedido2 = req.body;

            for (let i = 0; i <= pedido2.productos.length - 1; i++) {
              let insertProductos = db.sequelize.query(
                `insert into MRCCENTRAL.DBO.car_productos (idPedido, idProducto, descripcion, preciounit, cantidad) 
                VALUES ( ${idPedidoFromSQL[0].idPedido + 1}, ${
                  pedido2.productos[i].id
                }, '${pedido2.productos[i].descripcion}', ${
                  pedido2.productos[i].precio
                },
                ${pedido2.productos[i].cantidad});`
              );
            }
          });
      });

    res.status(201).json("Pedido creado");
  } catch (e) {
    res.status(500).json(`Error al ingresar el pedido ${e}`);
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
