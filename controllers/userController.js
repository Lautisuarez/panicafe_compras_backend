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
  const invalidCredentials = () =>
    res.status(401).json("Datos Incorrectos");

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
        return invalidCredentials();
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
        invalidCredentials();
      }
    })
    .catch(() => {
      return invalidCredentials();
    });
};

const firstDefinedString = (doc, keys) => {
  for (const k of keys) {
    if (doc[k] == null) continue;
    return String(doc[k]);
  }
  return "";
};

const getUsers = async (req, res) => {
  if (mongo.mongoDisabled) {
    return res.status(200).json([]);
  }
  try {
    // Native driver: returns raw BSON. Mongoose find().lean() was omitting nombre/email for some documents.
    const rows = await mongo.usuarios.collection
      .find({})
      .project({ pass: 0 })
      .toArray();
    const payload = rows.map((doc) => ({
      usuario: firstDefinedString(doc, ["usuario", "Usuario"]),
      nombre: firstDefinedString(doc, ["nombre", "Nombre"]),
      email: firstDefinedString(doc, ["email", "Email"]),
      id: doc.id,
      isAdmin: doc.isAdmin,
    }));
    res.status(200).json(payload);
  } catch (e) {
    console.error(e);
    res.status(500).json("error");
  }
};

const editUser = async (req, res) => {
  try {
    const { usuario, nombre, email, id, isAdmin, password } = req.body;
    if (!usuario || typeof usuario !== "string") {
      return res.status(400).json("usuario es requerido");
    }
    const key = usuario.toLowerCase();
    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (email !== undefined) update.email = email;
    if (id !== undefined) update.id = Number(id);
    if (isAdmin !== undefined) update.isAdmin = Number(isAdmin);
    if (password !== undefined && String(password).length > 0) {
      update.pass = password;
    }

    const updated = await mongo.usuarios
      .findOneAndUpdate(
        { usuario: key },
        { $set: update },
        { new: true }
      )
      .select("usuario nombre email id isAdmin -_id")
      .lean();

    if (!updated) {
      return res.status(404).json("El usuario no existe");
    }
    res.status(200).json({ message: "Usuario modificado", user: updated });
  } catch (e) {
    console.error(e);
    res.status(500).json("error");
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
