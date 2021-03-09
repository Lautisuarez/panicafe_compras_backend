
const express = require('express');
const db = require ('../db/db')
const Sequelize = require('sequelize');
const mongo = require('../db/mongo')
const middlewares = {};
const {jwt, privateKey} = require('../jwt/jwt')
 

/*middlewares.checkIsAdmin = async (req, res, next) => {
  datos = req.body
  console.log("DATOS", datos)
        
        const query = mongo.usuarios.findOne({usuario:datos.usuario})
        .then(function(result){
            ab = result.isAdmin
            
            if (ab === 1) {
                next()
            }

            else {
               res.status(401).json("No tiene permisos")
            }
        }
        ).catch(err => {
            return res.status(401).json("No tiene permisos");
          })
    }
*/
middlewares.checkIfAdminJWT = async( req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  jwt.verify(token, privateKey, (err, decoded) => {      
    if (err) {
      return res.json({ mensaje: 'No tiene permisos' });    
    } else {
      decoded.isAdmin == 1 ? next() : res.json({mensaje: "No tiene los permisos necesarios"})
      
    }
  });

}
middlewares.checkIsExist = async (req, res, next) => {
    const usuarioBody = req.body.usuario
    let checkuser = await mongo.usuarios.find({usuario: usuarioBody}).then(function(result){
        //console.log(result, "hoooooolllllaaaaaa")
        if (result[0].usuario == usuarioBody) {
            res.json(`ya existe el usuario ${usuarioBody}`)
        } else {
            console.log("se va ok")
            next()
        }
}    
    ) 

}

middlewares.checkJWT = async(req, res, next) => {

    const token = req.headers.authorization?.split(" ")[1];
    
    if (token) {
      jwt.verify(token, privateKey, (err, decoded) => {      
        if (err) {
          return res.json({ mensaje: 'Token inválida' });    
        } else {
          req.decoded = decoded;    
          console.log(decoded)
          next();
        }
      });
    } else {
      res.send({ 
          mensaje: 'Token no proveída.' 
      });
    }
}

module.exports = middlewares

