const mongo = require("../db/mongo");
const middlewares = {};
const { jwt, privateKey } = require("../jwt/jwt");

middlewares.checkIfAdminJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  jwt.verify(token, privateKey, (err, decoded) => {
    if (err) {
      return res.json({ mensaje: "No tiene permisos" });
    } else {
      decoded.isAdmin === 1
        ? next()
        : res.json({ mensaje: "No tiene los permisos necesarios" });
    }
  });
};

middlewares.checkIfProductionOrAdminJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  jwt.verify(token, privateKey, (err, decoded) => {
    if (err) {
      return res.json({ mensaje: "No tiene permisos" });
    } else {
      decoded.isAdmin === 2 || decoded.isAdmin === 1
        ? next()
        : res.json({ mensaje: "No tiene los permisos necesarios" });
    }
  });
};

middlewares.checkIfProductionJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  jwt.verify(token, privateKey, (err, decoded) => {
    if (err) {
      return res.json({ mensaje: "No tiene permisos" });
    } else {
      decoded.isAdmin === 2
        ? next()
        : res.json({ mensaje: "No tiene los permisos necesarios" });
    }
  });
};

middlewares.checkIsExist = async (req, res, next) => {
  const usuarioBody = req.body.usuario.toLowerCase();
  let checkuser = await mongo.usuarios
    .find({ usuario: usuarioBody })
    .then(function (result) {
      if (result[0]) {
        if (result[0].usuario == usuarioBody) {
          res.json(`ya existe el usuario ${usuarioBody}`);
        } else {
          console.log("se va ok");
          next();
        }
      } else {
        console.log("se va ok");
        next();
      }
    });
};

middlewares.checkIsExistEdit = async (req, res, next) => {
  const usuarioBody = req.body.usuario.toLowerCase();
  let checkuser = await mongo.usuarios
    .find({ usuario: usuarioBody })
    .then(function (result) {
      if (result.length == 0) {
        res.status(404).json("El usuario no existe");
      } else {
        console.log("se va");
        next();
      }
    });
};

middlewares.checkJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (token) {
    jwt.verify(token, privateKey, (err, decoded) => {
      if (err) {
        return res.json({ mensaje: "Token inválida" });
      } else {
        req.decoded = decoded;
        console.log(decoded);
        next();
      }
    });
  } else {
    res.send({
      mensaje: "Token no proveída.",
    });
  }
};

module.exports = middlewares;
