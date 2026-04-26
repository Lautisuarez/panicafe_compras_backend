const db = require("../db/db");
const mongo = require("../db/mongo");
const { privateKey, jwt } = require("../jwt/jwt");

const getInfoAddUser = async (req, res) => {
  try {
    await db.sequelize
      .query(
        `SELECT num_local, nom_local FROM MRCCENTRAL.DBO.locales order by num_local;`,
        {
          type: db.sequelize.QueryTypes.SELECT,
        }
      )
      .then((rows) => {
        const resultToSend = rows.map((item) => {
          return { id: item.num_local, nombre: item.nom_local.trim() };
        });

        res.json(resultToSend);
      });
  } catch {
    res
      .status(500)
      .json("La base de datos no está respondiendo.");
  }
};

const addUser = async (req, res) => {
  const { id, isAdmin, usuario, pass, nombre, email } = req.body;

  const createMongoUser = {
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

const login = async (req, res) => {
  const { usuario, pass } = req.body;
  if (!usuario || !pass) {
    return res.status(400).json("El usuario o contraseña son necesarios.");
  }
  const usuarioLowerCase = usuario.toLowerCase();

  if (mongo.mongoDisabled) {
    const payload = {
      isAdmin: 1,
      id: 0,
    };
    const token = jwt.sign(payload, privateKey, { expiresIn: 1440 });
    return res.json({
      nombre: "Dev",
      token,
    });
  }

  mongo.usuarios
    .find({ usuario: usuarioLowerCase })
    .then(function (result) {
      if (!result[0]) {
        return res.status(401).json("Datos Incorrectos");
      }
      const { usuario, pass: passHash, nombre, isAdmin, id } = result[0];
      if (usuario === usuarioLowerCase && passHash === pass) {
        const payload = {
          isAdmin: isAdmin,
          id,
        };
        const token = jwt.sign(payload, privateKey, {
          expiresIn: 1440, // 24 minutes
        });

        res.json({
          nombre,
          token: token,
        });
      } else {
        res.status(401).json("Datos Incorrectos");
      }
    })
    .catch(() => {
      return res.status(401).json("Datos Incorrectos");
    });
};

const getUsers = async (req, res) => {
  const rows = await mongo.usuarios.find().select("usuario -_id").lean();
  res.status(200).json(rows.map((u) => u.usuario));
};

const editUser = async (req, res) => {
  try {
    const datos = req.body;
    const usuariotoLower = datos.usuario.toLowerCase();
    await mongo.usuarios.findOne({ usuario: usuariotoLower });
    res.status(201).json("Usuario Modificado");
  } catch (e) {
    console.error(e);
    res.status(401).json("error");
  }
};

const deleteUser = async (req, res) => {
  const target = req.body.usuario.toLowerCase();
  await mongo.usuarios.deleteOne({ usuario: target });
  res.status(200).json("Usuario eliminado");
};

module.exports = {
  getInfoAddUser,
  addUser,
  login,
  getUsers,
  editUser,
  deleteUser,
};
